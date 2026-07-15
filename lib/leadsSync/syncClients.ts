// syncClients — orchestrates one Leads API → clients sync run
// (Live Monitor V1, Phase S2).
//
// Dry-run: fetch + normalize + diff against existing rows, ZERO writes
// (no clients write, no client_sync_runs row, no lock).
// Apply: lock → running client_sync_runs row → bounded batch upserts keyed on
// (source, external_client_id) → finalize run row → release lock in finally.
//
// Never deactivates or deletes missing clients — absence from the filtered
// endpoint is ambiguous by design. Never throws: every outcome is a report
// with a deterministic secret-free error code.

import { LeadsFetchError, type FetchLeadsResult } from "@/lib/leadsSync/fetchLeads";
import { prepareSyncBatch } from "@/lib/leadsSync/prepareSyncBatch";
import type { NormalizedClientRecord, SyncBatchMetrics } from "@/lib/leadsSync/types";
import type { SyncEnvironment, SyncMode } from "@/lib/leadsSync/syncCommand";

export const SYNC_LOCK_KEY = "leads-client-sync";
const LOCK_STALE_MINUTES = 10;
const DEFAULT_BATCH_SIZE = 100;
const UPSERT_CONFLICT_TARGET = "source,external_client_id";

// ── Narrow Supabase surface (repo pattern: type only what we call) ────────────

export interface SyncQueryResult<T = unknown> {
  data: T | null;
  error: { code?: string; message: string } | null;
}

interface DeleteByKey extends PromiseLike<SyncQueryResult> {
  lt(column: string, value: string): PromiseLike<SyncQueryResult>;
  eq(column: string, value: string): PromiseLike<SyncQueryResult>;
}

export interface SyncSupabase {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<SyncQueryResult<Record<string, unknown>[]>>;
    };
    insert(payload: Record<string, unknown>): PromiseLike<SyncQueryResult>;
    update(payload: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<SyncQueryResult>;
    };
    delete(): { eq(column: string, value: string): DeleteByKey };
    upsert(payload: Record<string, unknown>[], options: { onConflict: string }): PromiseLike<SyncQueryResult>;
  };
}

// ── Report types ──────────────────────────────────────────────────────────────

export interface ClientSyncMetrics extends SyncBatchMetrics {
  declared_count: number;
  inserted_count: number;
  updated_count: number;
  unchanged_count: number;
}

export interface ClientSyncReport {
  ok: boolean;
  mode: SyncMode;
  environment: SyncEnvironment;
  runId: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  metrics: ClientSyncMetrics | null;
}

export interface RunClientSyncInput {
  mode: SyncMode;
  environment: SyncEnvironment;
  projectRef: string;
  supabase: SyncSupabase;
  fetchLeads: () => Promise<FetchLeadsResult>;
  batchSize?: number;
  now?: () => Date;
}

// ── Diff (insert/update/unchanged) ────────────────────────────────────────────

// Synchronized cache fields only — volatile local fields (updated_at,
// last_synced_at, sync_generation, created_at, id) are never compared.
const COMPARE_KEYS = [
  "client_name",
  "contact_email",
  "recipient_email",
  "source_status",
  "is_active",
  "is_recipient_mappable",
  "assigned_ca_external_id",
  "assigned_ca_name",
  "assigned_ca_email",
  "plan",
  "target_role",
  "years_experience",
  "location",
  "number_of_applications",
  "start_date",
  "end_date",
  "source_created_at",
] as const;

const EXISTING_SELECT_COLUMNS = ["source", "external_client_id", ...COMPARE_KEYS].join(", ");

function valuesEqual(key: string, recordValue: unknown, existingValue: unknown): boolean {
  const a = recordValue ?? null;
  const b = existingValue ?? null;
  if (key === "source_created_at" && typeof a === "string" && typeof b === "string") {
    // Postgres renders timestamptz with an offset; compare instants, not strings.
    const ta = new Date(a).getTime();
    const tb = new Date(b).getTime();
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta === tb;
  }
  return a === b;
}

function classifyRecord(
  record: NormalizedClientRecord,
  existing: Map<string, Record<string, unknown>>,
): "insert" | "update" | "unchanged" {
  const current = existing.get(record.external_client_id);
  if (!current) return "insert";
  for (const key of COMPARE_KEYS) {
    if (!valuesEqual(key, record[key], current[key])) return "update";
  }
  return "unchanged";
}

// ── Lock (cron_locks conventions, dedicated key) ──────────────────────────────

async function acquireSyncLock(
  supabase: SyncSupabase,
  now: () => Date,
): Promise<{ ok: true; ownerToken: string } | { ok: false; code: "SYNC_ALREADY_RUNNING" | "SYNC_LOCK_FAILED" }> {
  // Fresh ownership token per run: release can only ever delete our own lock,
  // never a newer lock inserted after ours was stale-reclaimed.
  const ownerToken = crypto.randomUUID();
  const staleThreshold = new Date(now().getTime() - LOCK_STALE_MINUTES * 60_000).toISOString();
  try {
    // Stale reclaim deletes only rows past the threshold; the PK conflict below
    // still decides who wins the subsequent insert.
    await supabase.from("cron_locks").delete().eq("lock_key", SYNC_LOCK_KEY).lt("started_at", staleThreshold);
    const { error } = await supabase
      .from("cron_locks")
      .insert({ lock_key: SYNC_LOCK_KEY, started_at: now().toISOString(), owner_token: ownerToken });
    if (!error) return { ok: true, ownerToken };
    if (error.code === "23505") return { ok: false, code: "SYNC_ALREADY_RUNNING" };
    return { ok: false, code: "SYNC_LOCK_FAILED" };
  } catch {
    return { ok: false, code: "SYNC_LOCK_FAILED" };
  }
}

async function releaseSyncLock(supabase: SyncSupabase, ownerToken: string): Promise<void> {
  try {
    const { error } = await supabase
      .from("cron_locks")
      .delete()
      .eq("lock_key", SYNC_LOCK_KEY)
      .eq("owner_token", ownerToken);
    // Code-only report; stale-lock reclaim covers a lock we failed to release.
    if (error) console.error("[leads-sync] SYNC_LOCK_RELEASE_FAILED");
  } catch {
    console.error("[leads-sync] SYNC_LOCK_RELEASE_FAILED");
  }
}

// ── Run row helpers ───────────────────────────────────────────────────────────

function runRowBase(input: RunClientSyncInput, startedAtIso: string): Record<string, unknown> {
  return {
    source: "leads_api",
    environment: input.environment,
    project_ref: input.projectRef,
    started_at: startedAtIso,
  };
}

function metricColumns(metrics: ClientSyncMetrics | SyncBatchMetrics | null): Record<string, unknown> {
  return metrics ? { ...metrics } : {};
}

/** Best-effort failed-run record for failures outside the locked apply path. */
async function recordFailedRun(
  input: RunClientSyncInput,
  startedAtIso: string,
  errorCode: string,
  httpStatus: number | null,
  metrics: ClientSyncMetrics | SyncBatchMetrics | null,
  summary: string | null,
): Promise<void> {
  try {
    await input.supabase.from("client_sync_runs").insert({
      id: crypto.randomUUID(),
      ...runRowBase(input, startedAtIso),
      completed_at: (input.now ?? (() => new Date()))().toISOString(),
      status: "failed",
      http_status: httpStatus,
      error_code: errorCode,
      safe_error_summary: summary,
      ...metricColumns(metrics),
    });
  } catch {
    // Observability must never turn a failed sync into a crash.
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runClientSync(input: RunClientSyncInput): Promise<ClientSyncReport> {
  const now = input.now ?? (() => new Date());
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const startedAtIso = now().toISOString();
  const isApply = input.mode === "apply";

  const fail = (
    errorCode: string,
    httpStatus: number | null = null,
    metrics: ClientSyncMetrics | null = null,
    runId: string | null = null,
  ): ClientSyncReport => ({
    ok: false,
    mode: input.mode,
    environment: input.environment,
    runId,
    httpStatus,
    errorCode,
    metrics,
  });

  // 1. Fetch (validated inside fetchAllLeads: HTTP 200, JSON, count, pagination).
  let fetched: FetchLeadsResult;
  try {
    fetched = await input.fetchLeads();
  } catch (error) {
    const code = error instanceof LeadsFetchError ? error.code : "SYNC_UNEXPECTED_ERROR";
    const httpStatus = error instanceof LeadsFetchError ? error.httpStatus : null;
    if (isApply) await recordFailedRun(input, startedAtIso, code, httpStatus, null, null);
    return fail(code, httpStatus);
  }

  // 2. Normalize + duplicate policy (pure S1 modules).
  const batch = prepareSyncBatch(fetched.leads);
  if (!batch.ok) {
    if (isApply) {
      await recordFailedRun(input, startedAtIso, batch.errorCode, fetched.httpStatus, batch.metrics, null);
    }
    return fail(batch.errorCode, fetched.httpStatus);
  }

  // 3. Diff against the existing synchronized cache (read-only).
  let existingRows: Record<string, unknown>[];
  try {
    const { data, error } = await input.supabase
      .from("clients")
      .select(EXISTING_SELECT_COLUMNS)
      .eq("source", "leads_api");
    if (error) {
      if (isApply) await recordFailedRun(input, startedAtIso, "SYNC_READ_FAILED", fetched.httpStatus, batch.metrics, null);
      return fail("SYNC_READ_FAILED", fetched.httpStatus);
    }
    existingRows = data ?? [];
  } catch {
    if (isApply) await recordFailedRun(input, startedAtIso, "SYNC_READ_FAILED", fetched.httpStatus, batch.metrics, null);
    return fail("SYNC_READ_FAILED", fetched.httpStatus);
  }

  const existingById = new Map<string, Record<string, unknown>>();
  for (const row of existingRows) {
    if (typeof row.external_client_id === "string") existingById.set(row.external_client_id, row);
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const record of batch.records) {
    const kind = classifyRecord(record, existingById);
    if (kind === "insert") insertedCount++;
    else if (kind === "update") updatedCount++;
    else unchangedCount++;
  }

  const metrics: ClientSyncMetrics = {
    ...batch.metrics,
    declared_count: fetched.declaredCount,
    inserted_count: insertedCount,
    updated_count: updatedCount,
    unchanged_count: unchangedCount,
  };

  // 4. Dry-run stops here — zero writes of any kind.
  if (!isApply) {
    return {
      ok: true,
      mode: input.mode,
      environment: input.environment,
      runId: null,
      httpStatus: fetched.httpStatus,
      errorCode: null,
      metrics,
    };
  }

  // 5. Apply: lock, running run row, batched upserts, finalize.
  const lock = await acquireSyncLock(input.supabase, now);
  if (!lock.ok) return fail(lock.code, fetched.httpStatus, metrics);

  const runId = crypto.randomUUID();
  try {
    const { error: runInsertError } = await input.supabase.from("client_sync_runs").insert({
      id: runId,
      ...runRowBase(input, startedAtIso),
      status: "running",
      http_status: fetched.httpStatus,
      declared_count: fetched.declaredCount,
      fetched_count: batch.metrics.fetched_count,
    });
    if (runInsertError) return fail("SYNC_RUN_WRITE_FAILED", fetched.httpStatus, metrics);

    const syncGeneration = crypto.randomUUID();
    const syncedAtIso = now().toISOString();
    // Unchanged rows are upserted too: their cache fields are identical, but
    // last_synced_at/sync_generation still refresh. The metric stays "unchanged".
    const rows = batch.records.map((record) => ({
      ...record,
      last_synced_at: syncedAtIso,
      sync_generation: syncGeneration,
      updated_at: syncedAtIso,
    }));

    const totalBatches = Math.ceil(rows.length / batchSize);
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const chunk = rows.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
      const { error: upsertError } = await input.supabase
        .from("clients")
        .upsert(chunk, { onConflict: UPSERT_CONFLICT_TARGET });
      if (upsertError) {
        // Partial completion is reported honestly — upserts are idempotent and
        // the next successful run self-heals; nothing was deactivated or deleted.
        await finalizeRun(input, runId, "failed", now, metrics, "SYNC_UPSERT_FAILED",
          `batches_completed=${batchIndex}/${totalBatches}`);
        return fail("SYNC_UPSERT_FAILED", fetched.httpStatus, metrics, runId);
      }
    }

    const finalized = await finalizeRun(input, runId, "success", now, metrics, null, null);
    if (!finalized) return fail("SYNC_RUN_WRITE_FAILED", fetched.httpStatus, metrics, runId);

    return {
      ok: true,
      mode: input.mode,
      environment: input.environment,
      runId,
      httpStatus: fetched.httpStatus,
      errorCode: null,
      metrics,
    };
  } catch {
    await finalizeRun(input, runId, "failed", now, metrics, "SYNC_UNEXPECTED_ERROR", null);
    return fail("SYNC_UNEXPECTED_ERROR", fetched.httpStatus, metrics, runId);
  } finally {
    await releaseSyncLock(input.supabase, lock.ownerToken);
  }
}

async function finalizeRun(
  input: RunClientSyncInput,
  runId: string,
  status: "success" | "failed",
  now: () => Date,
  metrics: ClientSyncMetrics,
  errorCode: string | null,
  summary: string | null,
): Promise<boolean> {
  try {
    const { error } = await input.supabase
      .from("client_sync_runs")
      .update({
        completed_at: now().toISOString(),
        status,
        error_code: errorCode,
        safe_error_summary: summary,
        ...metricColumns(metrics),
      })
      .eq("id", runId);
    return !error;
  } catch {
    return false;
  }
}
