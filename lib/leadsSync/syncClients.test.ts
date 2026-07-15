import { describe, expect, it } from "vitest";

import { LeadsFetchError, type FetchLeadsResult } from "@/lib/leadsSync/fetchLeads";
import { runClientSync, SYNC_LOCK_KEY, type SyncSupabase } from "@/lib/leadsSync/syncClients";
import type { LeadsApiLead } from "@/lib/leadsSync/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function lead(overrides: Partial<LeadsApiLead>): LeadsApiLead {
  return {
    id: 1,
    name: "Client",
    email: "client@applywizard.ai",
    status: "In Progress",
    assigned_associate: { id: 9, name: "CA", email: "ca@applywizz.ai" },
    ...overrides,
  };
}

/** Existing clients row matching lead() defaults after normalization. */
function existingRow(externalId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: "leads_api",
    external_client_id: externalId,
    client_name: "Client",
    contact_email: `c${externalId}@applywizard.ai`,
    recipient_email: `c${externalId}@applywizard.ai`,
    source_status: "In Progress",
    is_active: true,
    is_recipient_mappable: true,
    assigned_ca_external_id: "9",
    assigned_ca_name: "CA",
    assigned_ca_email: "ca@applywizz.ai",
    plan: null,
    target_role: null,
    years_experience: null,
    location: null,
    number_of_applications: null,
    start_date: null,
    end_date: null,
    source_created_at: null,
    ...overrides,
  };
}

function fetchResult(leads: LeadsApiLead[]): () => Promise<FetchLeadsResult> {
  return async () => ({ leads, declaredCount: leads.length, httpStatus: 200, pages: 1 });
}

// ── Recording fake Supabase ───────────────────────────────────────────────────

interface DeleteCall {
  table: string;
  eqs: [string, string][];
  lt?: [string, string];
}

function createFakeSupabase(overrides: {
  existingClients?: Record<string, unknown>[];
  lockInsertError?: { code?: string; message: string };
  failUpsertAtIndex?: number;
  selectError?: boolean;
} = {}) {
  const calls = {
    selects: [] as { table: string; eq: [string, string] }[],
    inserts: [] as { table: string; payload: Record<string, unknown> }[],
    updates: [] as { table: string; payload: Record<string, unknown>; eq: [string, string] }[],
    deletes: [] as DeleteCall[],
    upserts: [] as { table: string; rows: Record<string, unknown>[]; onConflict: string }[],
  };
  const ok = Promise.resolve({ data: null, error: null });
  let upsertIndex = 0;

  const supabase = {
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              calls.selects.push({ table, eq: [column, value] });
              if (overrides.selectError) return Promise.resolve({ data: null, error: { message: "read failed" } });
              return Promise.resolve({ data: overrides.existingClients ?? [], error: null });
            },
          };
        },
        insert(payload: Record<string, unknown>) {
          calls.inserts.push({ table, payload });
          if (table === "cron_locks" && overrides.lockInsertError) {
            return Promise.resolve({ data: null, error: overrides.lockInsertError });
          }
          return ok;
        },
        update(payload: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              calls.updates.push({ table, payload, eq: [column, value] });
              return ok;
            },
          };
        },
        delete() {
          const record: DeleteCall = { table, eqs: [] };
          calls.deletes.push(record);
          const chain = {
            eq(column: string, value: string) {
              record.eqs.push([column, value]);
              return chain;
            },
            lt(ltColumn: string, ltValue: string) {
              record.lt = [ltColumn, ltValue];
              return ok;
            },
            then: ok.then.bind(ok),
          };
          return chain;
        },
        upsert(rows: Record<string, unknown>[], options: { onConflict: string }) {
          calls.upserts.push({ table, rows, onConflict: options.onConflict });
          if (overrides.failUpsertAtIndex === upsertIndex++) {
            return Promise.resolve({ data: null, error: { message: "batch failed" } });
          }
          return ok;
        },
      };
    },
  };

  return { supabase: supabase as unknown as SyncSupabase, calls };
}

function baseInput(supabase: SyncSupabase, fetchLeads: () => Promise<FetchLeadsResult>) {
  return {
    environment: "preview" as const,
    projectRef: "obirkjbzpykoehxacaaj",
    supabase,
    fetchLeads,
  };
}

// ── Dry run ───────────────────────────────────────────────────────────────────

describe("runClientSync dry-run", () => {
  it("computes insert/update/unchanged against existing rows with zero writes", async () => {
    const { supabase, calls } = createFakeSupabase({
      existingClients: [
        // Postgres offset format for the same instant → must count as unchanged.
        existingRow("1", { source_created_at: "2026-07-08T05:59:29.435+00:00" }),
        existingRow("2", { plan: "Old Plan" }), // differs → update
      ],
    });

    const report = await runClientSync({
      ...baseInput(supabase, fetchResult([
        lead({ id: 1, email: "c1@applywizard.ai", created_at: "2026-07-08T05:59:29.435Z" }),
        lead({ id: 2, email: "c2@applywizard.ai" }),
        lead({ id: 3, email: "c3@applywizard.ai" }), // new → insert
      ])),
      mode: "dry-run" as const,
    });

    expect(report.ok).toBe(true);
    expect(report.runId).toBeNull();
    expect(report.metrics).toMatchObject({
      declared_count: 3,
      fetched_count: 3,
      valid_count: 3,
      inserted_count: 1,
      updated_count: 1,
      unchanged_count: 1,
      mappable_count: 3,
    });

    // Zero writes: only the read-only clients diff select is allowed.
    expect(calls.inserts).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
    expect(calls.upserts).toHaveLength(0);
    expect(calls.deletes).toHaveLength(0);
    expect(calls.selects).toEqual([{ table: "clients", eq: ["source", "leads_api"] }]);
  });

  it("reflects duplicate-recipient quarantine in the metrics", async () => {
    const { supabase } = createFakeSupabase();
    const report = await runClientSync({
      ...baseInput(supabase, fetchResult([
        lead({ id: 1, email: "Shared@ApplyWizard.ai" }),
        lead({ id: 2, email: "shared@applywizard.ai" }),
        lead({ id: 3, email: "unique@applywizard.ai" }),
      ])),
      mode: "dry-run" as const,
    });

    expect(report.ok).toBe(true);
    expect(report.metrics).toMatchObject({
      duplicate_recipient_count: 2,
      mappable_count: 1,
      contact_only_count: 2,
    });
  });

  it("aborts safely on duplicate external ids without touching the database", async () => {
    const { supabase, calls } = createFakeSupabase();
    const report = await runClientSync({
      ...baseInput(supabase, fetchResult([lead({ id: 1 }), lead({ id: 1, email: "b@applywizard.ai" })])),
      mode: "dry-run" as const,
    });

    expect(report).toMatchObject({ ok: false, errorCode: "DUPLICATE_EXTERNAL_ID", runId: null });
    expect(calls.inserts).toHaveLength(0);
    expect(calls.upserts).toHaveLength(0);
    expect(calls.selects).toHaveLength(0);
  });
});

// ── Apply ─────────────────────────────────────────────────────────────────────

describe("runClientSync apply", () => {
  const fiveLeads = [1, 2, 3, 4, 5].map((id) => lead({ id, email: `c${id}@applywizard.ai` }));

  it("locks, records the run, batch-upserts by stable external identity, finalizes, releases", async () => {
    const { supabase, calls } = createFakeSupabase({ existingClients: [existingRow("1")] });

    const report = await runClientSync({
      ...baseInput(supabase, fetchResult(fiveLeads)),
      mode: "apply" as const,
      batchSize: 2,
    });

    expect(report.ok).toBe(true);
    expect(report.runId).not.toBeNull();
    expect(report.metrics).toMatchObject({ inserted_count: 4, updated_count: 0, unchanged_count: 1 });

    // Lock: stale reclaim (with lt) + acquire insert + owner-scoped release (no lt).
    const lockDeletes = calls.deletes.filter((d) => d.table === "cron_locks");
    expect(lockDeletes[0].eqs).toEqual([["lock_key", SYNC_LOCK_KEY]]);
    expect(lockDeletes[0].lt?.[0]).toBe("started_at");
    const lockInsert = calls.inserts.find((c) => c.table === "cron_locks");
    expect(lockInsert?.payload.lock_key).toBe(SYNC_LOCK_KEY);
    expect(typeof lockInsert?.payload.owner_token).toBe("string");
    const release = lockDeletes.at(-1)!;
    expect(release.lt).toBeUndefined();
    expect(release.eqs).toEqual([
      ["lock_key", SYNC_LOCK_KEY],
      ["owner_token", lockInsert?.payload.owner_token],
    ]);

    // Run row: created running, finalized success with aggregate counts.
    const runInsert = calls.inserts.find((c) => c.table === "client_sync_runs");
    expect(runInsert?.payload).toMatchObject({ status: "running", environment: "preview", declared_count: 5 });
    const finalize = calls.updates.find((c) => c.table === "client_sync_runs");
    expect(finalize?.payload).toMatchObject({
      status: "success",
      inserted_count: 4,
      updated_count: 0,
      unchanged_count: 1,
      error_code: null,
    });
    expect(finalize?.eq).toEqual(["id", report.runId]);

    // Bounded batches (5 rows / size 2 → 3 upserts) on the sync identity key.
    const clientUpserts = calls.upserts.filter((c) => c.table === "clients");
    expect(clientUpserts).toHaveLength(3);
    for (const upsert of clientUpserts) {
      expect(upsert.onConflict).toBe("source,external_client_id");
      for (const row of upsert.rows) {
        expect(row.id).toBeUndefined(); // stable UUID clients.id is never touched
        expect(row.source).toBe("leads_api");
        expect(typeof row.last_synced_at).toBe("string");
        expect(typeof row.sync_generation).toBe("string");
        expect(row.is_active).toBe(true); // never deactivates anything
      }
    }

    // No deletes on clients, ever.
    expect(calls.deletes.every((d) => d.table === "cron_locks")).toBe(true);
  });

  it("writes quarantined duplicate recipients as unmappable rows", async () => {
    const { supabase, calls } = createFakeSupabase();
    const report = await runClientSync({
      ...baseInput(supabase, fetchResult([
        lead({ id: 1, email: "Shared@ApplyWizard.ai" }),
        lead({ id: 2, email: "shared@applywizard.ai" }),
        lead({ id: 3, email: "unique@applywizard.ai" }),
      ])),
      mode: "apply" as const,
    });

    expect(report.ok).toBe(true);
    const rows = calls.upserts.flatMap((c) => c.rows);
    const quarantined = rows.filter((r) => r.recipient_email === null && r.is_recipient_mappable === false);
    expect(quarantined.map((r) => r.external_client_id).sort()).toEqual(["1", "2"]);
    expect(rows.find((r) => r.external_client_id === "3")).toMatchObject({
      recipient_email: "unique@applywizard.ai",
      is_recipient_mappable: true,
    });
  });

  it("exits safely when another run holds the lock", async () => {
    const { supabase, calls } = createFakeSupabase({
      lockInsertError: { code: "23505", message: "duplicate key" },
    });

    const report = await runClientSync({
      ...baseInput(supabase, fetchResult(fiveLeads)),
      mode: "apply" as const,
    });

    expect(report).toMatchObject({ ok: false, errorCode: "SYNC_ALREADY_RUNNING" });
    expect(calls.inserts.filter((c) => c.table === "client_sync_runs")).toHaveLength(0);
    expect(calls.upserts).toHaveLength(0);
    // A lock we never acquired is never released.
    expect(calls.deletes.filter((d) => d.table === "cron_locks" && !d.lt)).toHaveLength(0);
  });

  it("marks the run failed with honest partial completion when a later batch fails", async () => {
    const { supabase, calls } = createFakeSupabase({ failUpsertAtIndex: 1 });

    const report = await runClientSync({
      ...baseInput(supabase, fetchResult(fiveLeads)),
      mode: "apply" as const,
      batchSize: 2,
    });

    expect(report).toMatchObject({ ok: false, errorCode: "SYNC_UPSERT_FAILED" });
    expect(report.runId).not.toBeNull();
    const finalize = calls.updates.find((c) => c.table === "client_sync_runs");
    expect(finalize?.payload).toMatchObject({
      status: "failed",
      error_code: "SYNC_UPSERT_FAILED",
      safe_error_summary: "batches_completed=1/3",
    });
    // Lock released even on failure — and only with our own owner token.
    const ownToken = calls.inserts.find((c) => c.table === "cron_locks")?.payload.owner_token;
    const release = calls.deletes.find((d) => d.table === "cron_locks" && !d.lt);
    expect(release?.eqs).toEqual([
      ["lock_key", SYNC_LOCK_KEY],
      ["owner_token", ownToken],
    ]);
  });

  it("generates a fresh owner token per run so an old owner can never release a newer lock", async () => {
    const first = createFakeSupabase();
    const second = createFakeSupabase();
    await runClientSync({ ...baseInput(first.supabase, fetchResult(fiveLeads)), mode: "apply" as const });
    await runClientSync({ ...baseInput(second.supabase, fetchResult(fiveLeads)), mode: "apply" as const });

    const tokenOf = (calls: typeof first.calls) =>
      calls.inserts.find((c) => c.table === "cron_locks")?.payload.owner_token as string;
    const firstToken = tokenOf(first.calls);
    const secondToken = tokenOf(second.calls);
    expect(firstToken).not.toBe(secondToken);

    // Every release predicate is scoped to that run's own token — a reclaimed
    // (newer) lock row with a different token can never match an old owner's delete.
    for (const { calls } of [first, second]) {
      const release = calls.deletes.find((d) => d.table === "cron_locks" && !d.lt);
      expect(release?.eqs).toEqual([
        ["lock_key", SYNC_LOCK_KEY],
        ["owner_token", tokenOf(calls)],
      ]);
    }
  });

  it("records a best-effort failed run when the fetch itself fails, without locking", async () => {
    const { supabase, calls } = createFakeSupabase();
    const report = await runClientSync({
      ...baseInput(supabase, () => Promise.reject(new LeadsFetchError("LEADS_HTTP_SERVER_ERROR", 503))),
      mode: "apply" as const,
    });

    expect(report).toMatchObject({ ok: false, errorCode: "LEADS_HTTP_SERVER_ERROR", httpStatus: 503 });
    const failedRun = calls.inserts.find((c) => c.table === "client_sync_runs");
    expect(failedRun?.payload).toMatchObject({ status: "failed", error_code: "LEADS_HTTP_SERVER_ERROR" });
    expect(calls.inserts.filter((c) => c.table === "cron_locks")).toHaveLength(0);
    expect(calls.upserts).toHaveLength(0);
  });

  it("emits reports containing only aggregates — no emails, credentials, or client names", async () => {
    const { supabase } = createFakeSupabase();
    const report = await runClientSync({
      ...baseInput(supabase, fetchResult(fiveLeads)),
      mode: "apply" as const,
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("applywizard.ai");
    expect(serialized).not.toContain("Client");
    for (const value of Object.values(report.metrics ?? {})) {
      expect(typeof value).toBe("number");
    }
  });
});
