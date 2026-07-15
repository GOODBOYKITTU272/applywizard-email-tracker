import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildHealthPayload,
  createWorkerState,
  leadsSyncLoop,
  type WorkerState,
} from "@/worker/index";
import type { ClientSyncReport, LeadsWorkerConfig } from "@/lib/worker-core/leadsClientSync";

const STARTUP_DELAY_MS = 20_000;
const INTERVAL_MS = 600_000;

const readyConfig: LeadsWorkerConfig = {
  status: "ready",
  configured: true,
  environment: "preview",
  projectRef: "obirkjbzpykoehxacaaj",
};

function report(overrides: Partial<ClientSyncReport> = {}): ClientSyncReport {
  return {
    ok: true,
    mode: "apply",
    environment: "preview",
    runId: "run-1",
    httpStatus: 200,
    errorCode: null,
    metrics: {
      fetched_count: 339,
      valid_count: 339,
      invalid_count: 0,
      mappable_count: 300,
      contact_only_count: 39,
      missing_email_count: 0,
      duplicate_external_id_count: 0,
      duplicate_recipient_count: 0,
      null_associate_count: 2,
      declared_count: 339,
      inserted_count: 339,
      updated_count: 0,
      unchanged_count: 0,
    },
    ...overrides,
  };
}

function shutdown(state: WorkerState): void {
  state.isShuttingDown = true;
  for (const resolver of [...state.sleepResolvers]) resolver();
}

describe("leadsSyncLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("exits immediately when not configured — the rest of the worker keeps running", async () => {
    const state = createWorkerState();
    const runApply = vi.fn();

    await leadsSyncLoop(state, {
      resolveConfig: () => ({ status: "not_configured", configured: false }),
      runApply,
    });

    expect(runApply).not.toHaveBeenCalled();
    const health = buildHealthPayload(state, new Date(), Number.MAX_SAFE_INTEGER);
    expect(health.body.leads_sync).toMatchObject({ configured: false, enabled: true, last_status: null });
    // The loop resolving (instead of throwing) is what keeps Promise.all —
    // and with it the Zoho loops and health server — alive.
  });

  it("reports disabled configuration through health", async () => {
    const state = createWorkerState();
    await leadsSyncLoop(state, {
      resolveConfig: () => ({ status: "disabled", configured: true }),
      runApply: vi.fn(),
    });

    const health = buildHealthPayload(state, new Date(), Number.MAX_SAFE_INTEGER);
    expect(health.body.leads_sync).toMatchObject({ configured: true, enabled: false });
  });

  it("staggers the first run, then repeats on the 10-minute interval", async () => {
    const state = createWorkerState();
    const runApply = vi.fn().mockResolvedValue(report());
    const loop = leadsSyncLoop(state, { resolveConfig: () => readyConfig, runApply });

    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS - 1);
    expect(runApply).not.toHaveBeenCalled(); // staggered, not immediate

    await vi.advanceTimersByTimeAsync(1);
    expect(runApply).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(runApply).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runApply).toHaveBeenCalledTimes(2);

    shutdown(state);
    await loop;
  });

  it("publishes success metrics and next_run_at through health", async () => {
    const state = createWorkerState();
    const loop = leadsSyncLoop(state, {
      resolveConfig: () => readyConfig,
      runApply: vi.fn().mockResolvedValue(report()),
    });
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);

    const health = buildHealthPayload(state, new Date(), Number.MAX_SAFE_INTEGER).body.leads_sync;
    expect(health).toMatchObject({
      configured: true,
      enabled: true,
      last_status: "success",
      last_error_code: null,
      last_fetched_count: 339,
      last_valid_count: 339,
      last_mappable_count: 300,
    });
    expect(health.last_started_at).not.toBeNull();
    expect(health.last_completed_at).not.toBeNull();
    expect(health.next_run_at).toBe(new Date(Date.now() + INTERVAL_MS).toISOString());

    shutdown(state);
    await loop;
  });

  it("records a safe error code on failure and keeps looping", async () => {
    const state = createWorkerState();
    const runApply = vi
      .fn()
      .mockResolvedValueOnce(report({ ok: false, errorCode: "LEADS_HTTP_UNAUTHORIZED", metrics: null }))
      .mockResolvedValue(report());
    const loop = leadsSyncLoop(state, { resolveConfig: () => readyConfig, runApply });

    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    expect(state.leadsSync.lastStatus).toBe("failed");
    expect(state.leadsSync.lastErrorCode).toBe("LEADS_HTTP_UNAUTHORIZED");
    expect(buildHealthPayload(state, new Date(), Number.MAX_SAFE_INTEGER).body.error_count_last_hour).toBe(1);

    // The failure did not stop the loop: the next interval still runs.
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(runApply).toHaveBeenCalledTimes(2);
    expect(state.leadsSync.lastStatus).toBe("success");

    shutdown(state);
    await loop;
  });

  it("treats database-lock contention as a skipped run, not an error", async () => {
    const state = createWorkerState();
    const loop = leadsSyncLoop(state, {
      resolveConfig: () => readyConfig,
      runApply: vi.fn().mockResolvedValue(report({ ok: false, errorCode: "SYNC_ALREADY_RUNNING", metrics: null })),
    });

    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    expect(state.leadsSync.lastStatus).toBe("skipped");
    expect(buildHealthPayload(state, new Date(), Number.MAX_SAFE_INTEGER).body.error_count_last_hour).toBe(0);

    shutdown(state);
    await loop;
  });

  it("survives an unexpected rejection without throwing", async () => {
    const state = createWorkerState();
    const runApply = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(report());
    const loop = leadsSyncLoop(state, { resolveConfig: () => readyConfig, runApply });

    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    expect(state.leadsSync.lastStatus).toBe("failed");
    expect(state.leadsSync.lastErrorCode).toBe("SYNC_UNEXPECTED_ERROR");

    shutdown(state);
    await expect(loop).resolves.toBeUndefined();
  });

  it("never overlaps local runs: a long run defers the next one instead of stacking", async () => {
    const state = createWorkerState();
    let resolveRun: ((value: ClientSyncReport) => void) | null = null;
    // Only the FIRST run hangs; later runs resolve so shutdown can complete.
    const runApply = vi
      .fn<() => Promise<ClientSyncReport>>()
      .mockImplementationOnce(
        () => new Promise<ClientSyncReport>((resolvePromise) => { resolveRun = resolvePromise; }),
      )
      .mockResolvedValue(report());
    const loop = leadsSyncLoop(state, { resolveConfig: () => readyConfig, runApply });

    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    expect(runApply).toHaveBeenCalledTimes(1);

    // Three full intervals pass while the first run is still in flight.
    await vi.advanceTimersByTimeAsync(3 * INTERVAL_MS);
    expect(runApply).toHaveBeenCalledTimes(1);

    resolveRun!(report());
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(runApply).toHaveBeenCalledTimes(2);

    shutdown(state);
    await loop;
  });

  it("clears its timer on shutdown", async () => {
    const state = createWorkerState();
    const loop = leadsSyncLoop(state, {
      resolveConfig: () => readyConfig,
      runApply: vi.fn().mockResolvedValue(report()),
    });
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);

    shutdown(state);
    await loop;
    expect(state.sleepResolvers.size).toBe(0);
  });

  it("logs only aggregate counts and codes — no PII or secrets", async () => {
    const state = createWorkerState();
    const loop = leadsSyncLoop(state, {
      resolveConfig: () => readyConfig,
      runApply: vi
        .fn()
        .mockResolvedValueOnce(report())
        .mockResolvedValue(report({ ok: false, errorCode: "LEADS_HTTP_UNAUTHORIZED", metrics: null })),
    });
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS + INTERVAL_MS);
    shutdown(state);
    await loop;

    const logged = [
      ...(console.log as ReturnType<typeof vi.fn>).mock.calls,
      ...(console.error as ReturnType<typeof vi.fn>).mock.calls,
    ].flat().join("\n");
    expect(logged).toContain("[Leads Sync] completed fetched=339");
    expect(logged).toContain("[Leads Sync] failed code=LEADS_HTTP_UNAUTHORIZED");
    expect(logged).not.toContain("@");
    expect(logged).not.toContain("Authorization");
    expect(logged).not.toContain("password");
  });
});

describe("worker wiring", () => {
  it("schedules the leads loop beside the Zoho loops, importing only worker-core", () => {
    const source = readFileSync(resolve(__dirname, "index.ts"), "utf8");
    expect(source).toContain("@/lib/worker-core/leadsClientSync");
    expect(source).toMatch(/Promise\.all\(\[syncLoop\(state\), classifyLoop\(state\), leadsSyncLoop\(state\)\]\)/);
    expect(source).not.toContain("lib/leadsSync/fetchLeads");
  });
});
