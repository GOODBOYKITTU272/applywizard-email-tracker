import { createServer, type Server } from "http";

import { classifyQueue } from "@/lib/worker-core/classifyQueue";
import {
  DEFAULT_LEADS_SYNC_INTERVAL_MS,
  DEFAULT_LEADS_SYNC_STARTUP_DELAY_MS,
  resolveLeadsWorkerConfig,
  runLeadsClientSyncApply,
  type ClientSyncReport,
  type LeadsWorkerConfig,
  type SyncEnvironment,
} from "@/lib/worker-core/leadsClientSync";
import { syncTrackerMailbox } from "@/lib/worker-core/syncTrackerMailbox";

const DEFAULT_PORT = 3001;
const DEFAULT_SYNC_INTERVAL_MS = 60_000;
const DEFAULT_CLASSIFY_BATCH_SIZE = "5";
const DEFAULT_CLASSIFY_IDLE_WAIT_MS = 10_000;
const SYNC_STALE_MS = 5 * 60_000;
const STARTUP_GRACE_MS = 2 * 60_000;
const ERROR_WINDOW_MS = 60 * 60_000;

export interface LeadsSyncStatus {
  configured: boolean;
  enabled: boolean;
  lastStartedAt: Date | null;
  lastCompletedAt: Date | null;
  lastStatus: "success" | "skipped" | "failed" | null;
  lastErrorCode: string | null;
  lastFetchedCount: number | null;
  lastValidCount: number | null;
  lastMappableCount: number | null;
  nextRunAt: Date | null;
}

export interface WorkerState {
  startedAt: Date;
  lastSyncAt: Date | null;
  lastClassifyAt: Date | null;
  classifyCheckedTotal: number;
  classifyClassifiedTotal: number;
  syncFetchedTotal: number;
  errorTimestamps: Date[];
  isShuttingDown: boolean;
  sleepResolvers: Set<() => void>;
  leadsSync: LeadsSyncStatus;
}

export interface LeadsSyncHealth {
  configured: boolean;
  enabled: boolean;
  last_started_at: string | null;
  last_completed_at: string | null;
  last_status: "success" | "skipped" | "failed" | null;
  last_error_code: string | null;
  last_fetched_count: number | null;
  last_valid_count: number | null;
  last_mappable_count: number | null;
  next_run_at: string | null;
}

export interface HealthBody {
  status: "ok" | "degraded";
  uptime_seconds: number;
  last_sync_at: string | null;
  last_classify_at: string | null;
  classify_checked_total: number;
  classify_classified_total: number;
  sync_fetched_total: number;
  error_count_last_hour: number;
  leads_sync: LeadsSyncHealth;
}

export function createWorkerState(now = new Date()): WorkerState {
  return {
    startedAt: now,
    lastSyncAt: null,
    lastClassifyAt: null,
    classifyCheckedTotal: 0,
    classifyClassifiedTotal: 0,
    syncFetchedTotal: 0,
    errorTimestamps: [],
    isShuttingDown: false,
    sleepResolvers: new Set(),
    leadsSync: {
      configured: false,
      enabled: false,
      lastStartedAt: null,
      lastCompletedAt: null,
      lastStatus: null,
      lastErrorCode: null,
      lastFetchedCount: null,
      lastValidCount: null,
      lastMappableCount: null,
      nextRunAt: null,
    },
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function errorCountLastHour(state: WorkerState, now: Date): number {
  const cutoff = now.getTime() - ERROR_WINDOW_MS;
  state.errorTimestamps = state.errorTimestamps.filter((at) => at.getTime() >= cutoff);
  return state.errorTimestamps.length;
}

export function buildHealthPayload(
  state: WorkerState,
  now = new Date(),
  startupGraceMs = STARTUP_GRACE_MS,
): { httpStatus: 200 | 503; body: HealthBody } {
  const pastGrace = now.getTime() - state.startedAt.getTime() > startupGraceMs;
  const syncMissing = !state.lastSyncAt && pastGrace;
  const syncStale = Boolean(
    state.lastSyncAt && now.getTime() - state.lastSyncAt.getTime() > SYNC_STALE_MS,
  );
  const degraded = syncMissing || syncStale;

  return {
    httpStatus: degraded ? 503 : 200,
    body: {
      status: degraded ? "degraded" : "ok",
      uptime_seconds: Math.max(0, Math.floor((now.getTime() - state.startedAt.getTime()) / 1000)),
      last_sync_at: state.lastSyncAt?.toISOString() ?? null,
      last_classify_at: state.lastClassifyAt?.toISOString() ?? null,
      classify_checked_total: state.classifyCheckedTotal,
      classify_classified_total: state.classifyClassifiedTotal,
      sync_fetched_total: state.syncFetchedTotal,
      error_count_last_hour: errorCountLastHour(state, now),
      // Aggregate-only Leads sync status: counts, codes, and timestamps —
      // never credentials, client names, or email addresses.
      leads_sync: {
        configured: state.leadsSync.configured,
        enabled: state.leadsSync.enabled,
        last_started_at: state.leadsSync.lastStartedAt?.toISOString() ?? null,
        last_completed_at: state.leadsSync.lastCompletedAt?.toISOString() ?? null,
        last_status: state.leadsSync.lastStatus,
        last_error_code: state.leadsSync.lastErrorCode,
        last_fetched_count: state.leadsSync.lastFetchedCount,
        last_valid_count: state.leadsSync.lastValidCount,
        last_mappable_count: state.leadsSync.lastMappableCount,
        next_run_at: state.leadsSync.nextRunAt?.toISOString() ?? null,
      },
    },
  };
}

function recordError(state: WorkerState): void {
  state.errorTimestamps.push(new Date());
  errorCountLastHour(state, new Date());
}

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error && /rate.?limit/i.test(error.message)) {
    return { code: "RATE_LIMITED", message: "Worker dependency rate limited." };
  }
  if (error instanceof Error && /auth|unauthori[sz]ed|forbidden/i.test(error.message)) {
    return { code: "AUTH_FAILED", message: "Worker dependency authentication failed." };
  }
  if (error instanceof Error && /timeout|timed out|abort/i.test(error.message)) {
    return { code: "TIMEOUT", message: "Worker dependency timed out." };
  }
  return { code: "WORKER_ERROR", message: "Worker cycle failed." };
}

function sleep(ms: number, state: WorkerState): Promise<void> {
  if (state.isShuttingDown) return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = setTimeout(done, ms);
    function done() {
      clearTimeout(timeout);
      state.sleepResolvers.delete(done);
      resolve();
    }
    state.sleepResolvers.add(done);
  });
}

async function syncLoop(state: WorkerState): Promise<void> {
  const intervalMs = positiveInt(process.env.WORKER_SYNC_INTERVAL_MS, DEFAULT_SYNC_INTERVAL_MS);

  while (!state.isShuttingDown) {
    const started = Date.now();
    try {
      const result = await syncTrackerMailbox();
      state.lastSyncAt = new Date();
      state.syncFetchedTotal += result.fetched;
      console.log(
        `[Worker:Sync] fetched=${result.fetched} inserted=${result.inserted} skipped=${result.skipped} duration_ms=${Date.now() - started}`,
      );
      if (!state.isShuttingDown) await sleep(intervalMs, state);
    } catch (error) {
      const safe = safeError(error);
      recordError(state);
      console.error(`[Worker:Sync] ${safe.code} ${safe.message}`);
      if (!state.isShuttingDown) await sleep(60_000, state);
    }
  }
}

async function classifyLoop(state: WorkerState): Promise<void> {
  if (!process.env.ZOHO_CLASSIFY_MAX_PER_RUN) {
    process.env.ZOHO_CLASSIFY_MAX_PER_RUN =
      process.env.WORKER_CLASSIFY_BATCH_SIZE ?? DEFAULT_CLASSIFY_BATCH_SIZE;
  }

  const idleWaitMs = positiveInt(
    process.env.WORKER_CLASSIFY_IDLE_WAIT_MS,
    DEFAULT_CLASSIFY_IDLE_WAIT_MS,
  );

  while (!state.isShuttingDown) {
    const started = Date.now();
    try {
      const result = await classifyQueue();
      state.lastClassifyAt = new Date();
      state.classifyCheckedTotal += result.checked;
      state.classifyClassifiedTotal += result.classified;
      console.log(
        `[Worker:Classify] checked=${result.checked} classified=${result.classified} review=${result.review_required} failed=${result.failed} duration_ms=${Date.now() - started}`,
      );
      if (!state.isShuttingDown && result.checked === 0) await sleep(idleWaitMs, state);
    } catch (error) {
      const safe = safeError(error);
      recordError(state);
      console.error(`[Worker:Classify] ${safe.code} ${safe.message}`);
      if (!state.isShuttingDown) await sleep(30_000, state);
    }
  }
}

export interface LeadsLoopDeps {
  resolveConfig: () => LeadsWorkerConfig;
  runApply: (target: { environment: SyncEnvironment; projectRef: string }) => Promise<ClientSyncReport>;
}

/**
 * Leads client-sync loop. Sequential by construction: one run must finish
 * before the next interval sleep starts, so a long run can never spawn
 * overlapping local executions; the S2 database lock still protects against
 * other Render instances (contention is a safe "skipped", never a crash).
 * A failed run only records state/logs a code — Zoho sync, classification,
 * and the health server are separate loops and keep running.
 */
export async function leadsSyncLoop(state: WorkerState, deps?: Partial<LeadsLoopDeps>): Promise<void> {
  const resolveConfig = deps?.resolveConfig ?? (() => resolveLeadsWorkerConfig(process.env));
  const runApply = deps?.runApply ?? runLeadsClientSyncApply;

  const config = resolveConfig();
  state.leadsSync.configured = config.configured;
  state.leadsSync.enabled = config.status !== "disabled";
  if (config.status !== "ready") {
    console.log(
      `[Leads Sync] inactive status=${config.status}` +
        (config.status === "guard_failed" ? ` code=${config.guardCode}` : ""),
    );
    return;
  }

  const intervalMs = positiveInt(process.env.WORKER_LEADS_SYNC_INTERVAL_MS, DEFAULT_LEADS_SYNC_INTERVAL_MS);
  const startupDelayMs = positiveInt(
    process.env.WORKER_LEADS_SYNC_STARTUP_DELAY_MS,
    DEFAULT_LEADS_SYNC_STARTUP_DELAY_MS,
  );

  // Staggered first run: never starts at the same instant as the Zoho loops.
  state.leadsSync.nextRunAt = new Date(Date.now() + startupDelayMs);
  await sleep(startupDelayMs, state);

  while (!state.isShuttingDown) {
    const started = Date.now();
    state.leadsSync.lastStartedAt = new Date();
    try {
      const report = await runApply(config);
      state.leadsSync.lastCompletedAt = new Date();
      if (report.ok) {
        state.leadsSync.lastStatus = "success";
        state.leadsSync.lastErrorCode = null;
        state.leadsSync.lastFetchedCount = report.metrics?.fetched_count ?? null;
        state.leadsSync.lastValidCount = report.metrics?.valid_count ?? null;
        state.leadsSync.lastMappableCount = report.metrics?.mappable_count ?? null;
        console.log(
          `[Leads Sync] completed fetched=${report.metrics?.fetched_count ?? 0} valid=${report.metrics?.valid_count ?? 0} mappable=${report.metrics?.mappable_count ?? 0} duration_ms=${Date.now() - started}`,
        );
      } else if (report.errorCode === "SYNC_ALREADY_RUNNING") {
        // Another instance holds the DB lock — a normal skipped run, not an error.
        state.leadsSync.lastStatus = "skipped";
        state.leadsSync.lastErrorCode = report.errorCode;
        console.log(`[Leads Sync] skipped code=${report.errorCode}`);
      } else {
        state.leadsSync.lastStatus = "failed";
        state.leadsSync.lastErrorCode = report.errorCode ?? "SYNC_UNEXPECTED_ERROR";
        recordError(state);
        console.error(`[Leads Sync] failed code=${state.leadsSync.lastErrorCode}`);
      }
    } catch {
      // runClientSync never throws by contract; belt-and-braces so a Leads
      // failure can never take down the worker.
      state.leadsSync.lastCompletedAt = new Date();
      state.leadsSync.lastStatus = "failed";
      state.leadsSync.lastErrorCode = "SYNC_UNEXPECTED_ERROR";
      recordError(state);
      console.error("[Leads Sync] failed code=SYNC_UNEXPECTED_ERROR");
    }

    state.leadsSync.nextRunAt = new Date(Date.now() + intervalMs);
    if (!state.isShuttingDown) await sleep(intervalMs, state);
  }
}

function createHealthServer(state: WorkerState): Server {
  return createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/health") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    const health = buildHealthPayload(state);
    res.writeHead(health.httpStatus, { "content-type": "application/json" });
    res.end(JSON.stringify(health.body));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export async function startWorker(): Promise<void> {
  const state = createWorkerState();
  const server = createHealthServer(state);
  const port = positiveInt(process.env.PORT, DEFAULT_PORT);

  server.listen(port, () => {
    console.log(`[Worker:Health] listening port=${port}`);
  });

  const stop = async () => {
    if (state.isShuttingDown) return;
    state.isShuttingDown = true;
    for (const resolve of [...state.sleepResolvers]) resolve();
    await closeServer(server);
  };

  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());

  await Promise.all([syncLoop(state), classifyLoop(state), leadsSyncLoop(state)]);
}

process.once("uncaughtException", (error) => {
  console.error(`[Worker:Fatal] ${safeError(error).message}`);
  process.exit(1);
});

process.once("unhandledRejection", (error) => {
  console.error(`[Worker:Fatal] ${safeError(error).message}`);
  process.exit(1);
});

if (typeof require !== "undefined" && require.main === module) {
  void startWorker().then(() => process.exit(0));
}
