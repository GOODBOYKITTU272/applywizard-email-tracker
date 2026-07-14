import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "fs";
import { resolve } from "path";

import {
  runZohoHistoryBackfill,
  toBackfillErrorCode,
  type BackfillDeps,
} from "./backfillZohoHistory";

const connection = {
  id: "conn-1",
  zoho_account_id: "acct-1",
  email_address: "tracker@applywizard.ai",
  access_token: "tok",
  access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  refresh_token: "ref",
};

function opts(overrides: Parameters<typeof runZohoHistoryBackfill>[0]) {
  return {
    mailbox: "tracker@applywizard.ai",
    mailBaseUrl: "https://mail.zoho.test",
    ...overrides,
  };
}

function messages(ids: string[]) {
  return ids.map((id, index) => ({
    messageId: id,
    sender: "sender@example.com",
    subject: `Email ${id}`,
    receivedTime: Date.parse("2026-06-30T04:00:00.000Z") - index * 1000,
    folderName: "Inbox",
    folderId: "folder-1",
    hasAttachment: "0",
  }));
}

function manyMessages(count: number) {
  return messages(Array.from({ length: count }, (_, index) => `m${count - index}`));
}

function makeSupabase(existing: string[] = []) {
  const checkpointUpsert = vi.fn().mockResolvedValue({ error: null });
  const metadataUpsert = vi.fn().mockResolvedValue({ error: null });
  const calls = { checkpointUpsert, metadataUpsert };

  return {
    calls,
    client: {
      from: (table: string) => {
        if (table === "zoho_connections") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: connection, error: null }),
                }),
              }),
            }),
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          };
        }

        if (table === "zoho_backfill_checkpoints") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
            upsert: checkpointUpsert,
          };
        }

        if (table === "zoho_sync_checkpoints") {
          throw new Error("live checkpoint table must not be touched");
        }

        return {
          select: () => ({
            eq: () => ({
              in: (_col: string, ids: string[]) =>
                Promise.resolve({
                  data: ids
                    .filter((id) => existing.includes(id))
                    .map((message_id) => ({ message_id })),
                  error: null,
                }),
            }),
          }),
          upsert: metadataUpsert,
        };
      },
    },
  };
}

function deps(fetchImpl: BackfillDeps["fetchImpl"], existing: string[] = []): BackfillDeps {
  const supabase = makeSupabase(existing);
  return {
    supabase: supabase.client,
    fetchImpl,
    sleep: vi.fn().mockResolvedValue(undefined),
    now: () => new Date("2026-07-01T00:00:00.000Z"),
    log: vi.fn(),
    shouldStop: () => false,
  };
}

describe("runZohoHistoryBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to dry-run and paginates newest toward older offsets", async () => {
    const urls: string[] = [];
    const d = deps(vi.fn().mockImplementation((url: string) => {
      urls.push(url);
      const page = urls.length === 1 ? messages(["m3", "m2"]) : messages(["m1"]);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ status: { code: 200 }, data: page }),
      });
    }));

    const result = await runZohoHistoryBackfill(
      opts({ pageSize: 2, maxPages: 2, dryRun: true, startOffset: 0 }),
      d,
    );

    expect(urls[0]).toContain("limit=2&start=0");
    expect(urls[1]).toContain("limit=2&start=2");
    expect(result.fetched).toBe(3);
    expect(result.dryRun).toBe(true);
  });

  it("resumes from the separate backfill checkpoint", async () => {
    const supabase = makeSupabase();
    supabase.client.from = ((original) => (table: string) => {
      if (table === "zoho_backfill_checkpoints") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { mailbox_email: connection.email_address, next_start: 40 },
                  error: null,
                }),
            }),
          }),
          upsert: supabase.calls.checkpointUpsert,
        };
      }
      return original(table);
    })(supabase.client.from);

    const urls: string[] = [];
    await runZohoHistoryBackfill(
      opts({ pageSize: 10, maxPages: 1, dryRun: true, startOffset: 0 }),
      {
        ...deps((url: string) => {
          urls.push(url);
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () => Promise.resolve({ status: { code: 200 }, data: [] }),
          });
        }),
        supabase: supabase.client,
      },
    );

    expect(urls[0]).toContain("start=40");
  });

  it("does not write metadata or checkpoints during dry-run", async () => {
    const supabase = makeSupabase();
    const result = await runZohoHistoryBackfill(
      opts({ pageSize: 2, maxPages: 1, dryRun: true, startOffset: 0 }),
      {
        ...deps(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () => Promise.resolve({ status: { code: 200 }, data: messages(["m1"]) }),
          }),
        ),
        supabase: supabase.client,
      },
    );

    expect(result.wouldInsert).toBe(1);
    expect(supabase.calls.metadataUpsert).not.toHaveBeenCalled();
    expect(supabase.calls.checkpointUpsert).not.toHaveBeenCalled();
  });

  it("real backfill rows land in a safe holding status", async () => {
    const supabase = makeSupabase();

    await runZohoHistoryBackfill(
      opts({ pageSize: 1, maxPages: 1, dryRun: false, confirmProductionBackfill: true, startOffset: 0 }),
      {
        ...deps(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () => Promise.resolve({ status: { code: 200 }, data: messages(["m1"]) }),
          }),
        ),
        supabase: supabase.client,
      },
    );

    const rows = supabase.calls.metadataUpsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows[0].classification_status).toBe("historical_ingested");
  });

  it("real backfill of 100 emails creates zero live-classifier eligible rows", async () => {
    const supabase = makeSupabase();

    await runZohoHistoryBackfill(
      opts({ pageSize: 100, maxPages: 1, dryRun: false, confirmProductionBackfill: true, startOffset: 0 }),
      {
        ...deps(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () => Promise.resolve({ status: { code: 200 }, data: manyMessages(100) }),
          }),
        ),
        supabase: supabase.client,
      },
    );

    const rows = supabase.calls.metadataUpsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    const claimable = rows.filter((row) =>
      ["pending", "processing", "retry_scheduled"].includes(String(row.classification_status)),
    );
    expect(rows).toHaveLength(100);
    expect(claimable).toHaveLength(0);
  });

  it("backfilled rows are not claimable by the live classifier", async () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202606300001_queue_foundation.sql"),
      "utf8",
    );
    const backfillMigration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202607070002_allow_historical_ingested_status.sql"),
      "utf8",
    );

    expect(backfillMigration).toContain("'historical_ingested'");
    expect(migration).toContain("classification_status in ('pending', 'retry_scheduled', 'processing')");
    expect(migration).not.toContain("'historical_ingested'");
  });

  it("counts duplicates without inserting new identities", async () => {
    const d = deps(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: () => Promise.resolve({ status: { code: 200 }, data: messages(["m2", "m1"]) }),
        }),
      ["m1"],
    );

    const result = await runZohoHistoryBackfill(
      opts({ pageSize: 2, maxPages: 1, dryRun: false, confirmProductionBackfill: true, startOffset: 0 }),
      d,
    );

    expect(result.inserted).toBe(1);
    expect(result.updated).toBe(1);
  });

  it("waits and retries the same page on rate limits", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => "2" },
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ status: { code: 200 }, data: [] }),
      });
    const d = deps(fetchImpl);

    await runZohoHistoryBackfill(
      opts({ pageSize: 10, maxPages: 1, dryRun: true, startOffset: 0 }),
      d,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledWith(2000);
  });

  it("saves checkpoint after a real page before honoring interruption", async () => {
    let stop = false;
    const supabase = makeSupabase();
    const d = deps(() => {
      stop = true;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: () => Promise.resolve({ status: { code: 200 }, data: messages(["m1"]) }),
      });
    });

    const result = await runZohoHistoryBackfill(
      opts({ pageSize: 1, maxPages: 2, dryRun: false, confirmProductionBackfill: true, startOffset: 0 }),
      { ...d, supabase: supabase.client, shouldStop: () => stop },
    );

    expect(result.stopped).toBe(true);
    expect(supabase.calls.checkpointUpsert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ next_start: 1 })]),
      expect.anything(),
    );
  });

  it("never touches the live sync checkpoint table", async () => {
    const touchedTables: string[] = [];
    const supabase = makeSupabase();
    const originalFrom = supabase.client.from;
    supabase.client.from = (table: string) => {
      touchedTables.push(table);
      return originalFrom(table);
    };

    await runZohoHistoryBackfill(
      opts({ pageSize: 1, maxPages: 1, dryRun: false, confirmProductionBackfill: true, startOffset: 0 }),
      {
        ...deps(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: () => Promise.resolve({ status: { code: 200 }, data: messages(["m1"]) }),
          }),
        ),
        supabase: supabase.client,
      },
    );

    expect(touchedTables).not.toContain("zoho_sync_checkpoints");
    expect(touchedTables).toContain("zoho_backfill_checkpoints");
  });

  it("stops exactly at BACKFILL_MAX_PAGES when every page is full", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve({ status: { code: 200 }, data: messages(["m2", "m1"]) }),
    });

    const result = await runZohoHistoryBackfill(
      opts({ pageSize: 2, maxPages: 3, dryRun: true, startOffset: 0 }),
      deps(fetchImpl),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.pages).toBe(3);
    expect(result.fetched).toBe(6);
    expect(result.nextStart).toBe(6);
  });

  it("refuses real ingestion without the production confirmation flag", async () => {
    await expect(
      runZohoHistoryBackfill(
        opts({ pageSize: 1, maxPages: 1, dryRun: false, startOffset: 0 }),
        deps(() => Promise.reject(new Error("should not fetch"))),
      ),
    ).rejects.toThrow("--confirm-production-backfill");
  });

  it("maps raw errors to fixed safe error codes without leaking text", () => {
    const code = toBackfillErrorCode(
      new Error("database failed for tracker@applywizard.ai token abc123 provider payload"),
    );

    expect(code).toBe("BACKFILL_UNKNOWN_ERROR");
    expect(code).not.toContain("tracker@applywizard.ai");
    expect(code).not.toContain("abc123");
    expect(code).not.toContain("provider payload");
  });

  it("script catch path logs only safe error codes", () => {
    const script = readFileSync(resolve(__dirname, "../../scripts/backfill-zoho-history.ts"), "utf8");

    expect(script).toContain("toBackfillErrorCode(error)");
    expect(script).toContain("failed code=");
    expect(script).not.toContain("error.message");
    expect(script).not.toContain("String(error)");
  });
});
