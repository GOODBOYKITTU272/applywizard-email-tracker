import { readFileSync } from "fs";
import { resolve } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

function makeSupabase(overrides: {
  countResult?: { count: number | null; error: { message: string } | null };
  rpcResult?: { data: string[] | null; error: { message: string } | null };
  insertResult?: { error: { message: string } | null };
} = {}) {
  const countResult = overrides.countResult ?? { count: 0, error: null };
  const rpcResult = overrides.rpcResult ?? { data: [], error: null };
  const insertResult = overrides.insertResult ?? { error: null };

  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const insert = vi.fn().mockResolvedValue(insertResult);

  const from = vi.fn((table: string) => {
    if (table === "zoho_email_metadata") {
      return {
        select: () => ({
          eq: () => Promise.resolve(countResult),
        }),
      };
    }
    if (table === "zoho_release_batches") {
      return { insert };
    }
    throw new Error(`Unexpected table in test mock: ${table}`);
  });

  return { client: { rpc, from }, rpc, insert, from };
}

let mockSupabase: ReturnType<typeof makeSupabase>;

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => mockSupabase.client,
}));

describe("runHistoricalRelease", () => {
  beforeEach(() => {
    mockSupabase = makeSupabase();
  });

  it("dry-run counts eligible rows and never calls the mutating RPC", async () => {
    mockSupabase = makeSupabase({ countResult: { count: 4200, error: null } });

    const { runHistoricalRelease } = await import("./releaseHistoricalBatch");
    const result = await runHistoricalRelease({ mailbox: "tracker@applywizard.ai", dryRun: true });

    expect(result).toEqual({ ok: true, dryRun: true, eligibleCount: 4200 });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(mockSupabase.insert).not.toHaveBeenCalled();
  });

  it("refuses a real release without confirmProductionRelease", async () => {
    const { runHistoricalRelease } = await import("./releaseHistoricalBatch");
    const result = await runHistoricalRelease({ mailbox: "tracker@applywizard.ai", dryRun: false });

    expect(result).toEqual({ ok: false, code: "RELEASE_CONFIRMATION_REQUIRED" });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("calls release_historical_batch with the hard-coded 100 limit, never more", async () => {
    mockSupabase = makeSupabase({ rpcResult: { data: Array.from({ length: 100 }, (_, i) => `id-${i}`), error: null } });

    const { runHistoricalRelease, RELEASE_BATCH_SIZE } = await import("./releaseHistoricalBatch");
    await runHistoricalRelease({
      mailbox: "tracker@applywizard.ai",
      dryRun: false,
      confirmProductionRelease: true,
    });

    expect(RELEASE_BATCH_SIZE).toBe(100);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "release_historical_batch",
      expect.objectContaining({ p_mailbox_email: "tracker@applywizard.ai", p_limit: 100 }),
    );
  });

  it("records a zoho_release_batches row with the actual released count, not the requested size", async () => {
    mockSupabase = makeSupabase({ rpcResult: { data: ["id-1", "id-2", "id-3"], error: null } });

    const { runHistoricalRelease } = await import("./releaseHistoricalBatch");
    const result = await runHistoricalRelease({
      mailbox: "tracker@applywizard.ai",
      dryRun: false,
      confirmProductionRelease: true,
    });

    expect(result.ok && !result.dryRun && result.releasedCount).toBe(3);
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ requested_size: 100, released_count: 3, dry_run: false }),
    );
  });

  it("maps a Supabase RPC failure to a safe error code, never the raw message", async () => {
    mockSupabase = makeSupabase({
      rpcResult: { data: null, error: { message: "relation zoho_email_metadata violates row-level security for user x@y.com" } },
    });

    const { runHistoricalRelease } = await import("./releaseHistoricalBatch");
    const result = await runHistoricalRelease({
      mailbox: "tracker@applywizard.ai",
      dryRun: false,
      confirmProductionRelease: true,
    });

    expect(result).toEqual({ ok: false, code: "RELEASE_SUPABASE_FAILED" });
  });

  it("never queries or logs subject, sender, or body fields", () => {
    const src = readFileSync(resolve(__dirname, "releaseHistoricalBatch.ts"), "utf8");
    expect(src).not.toMatch(/\bsubject\b/);
    expect(src).not.toMatch(/\bsender\b/);
    expect(src).not.toMatch(/original_recipient/);
  });
});

describe("release_historical_batch migration properties", () => {
  it("orders eligible rows newest received_at first", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202607080002_add_release_historical_batch.sql"),
      "utf8",
    );
    expect(migration).toContain("order by received_at desc");
  });

  it("only selects historical_ingested rows and locks them against concurrent release", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202607080002_add_release_historical_batch.sql"),
      "utf8",
    );
    expect(migration).toContain("classification_status = 'historical_ingested'");
    expect(migration).toContain("for update skip locked");
  });

  it("clamps the limit to 100 inside the SQL function itself, independent of the caller", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202607080002_add_release_historical_batch.sql"),
      "utf8",
    );
    expect(migration).toContain("limit least(greatest(p_limit, 0), 100)");
  });

  it("changes only classification_status and release_batch_id on release", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202607080002_add_release_historical_batch.sql"),
      "utf8",
    );
    const setClauseMatch = migration.match(/set\s+classification_status = 'pending',\s*\n\s*release_batch_id = p_batch_id,\s*\n\s*updated_at = now\(\)/);
    expect(setClauseMatch).not.toBeNull();
  });
});
