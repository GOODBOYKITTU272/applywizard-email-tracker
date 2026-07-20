import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const mockDb = vi.hoisted(() => ({
  deletes: [] as Array<{ table: string; filters: Array<[string, unknown]>; lt?: [string, unknown] }>,
  inserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  lockInsertError: null as null | { code?: string; message: string },
  freshConnection: null as null | {
    access_token: string;
    access_token_expires_at: string;
    refresh_token: string;
  },
  updateError: null as null | { message: string },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "cron_locks") {
        return {
          delete: () => ({
            eq: (col: string, val: unknown) => {
              const filters: Array<[string, unknown]> = [[col, val]];
              return {
                eq: (col2: string, val2: unknown) => {
                  filters.push([col2, val2]);
                  mockDb.deletes.push({ table, filters: [...filters] });
                  return Promise.resolve({ error: null });
                },
                lt: (col2: string, val2: unknown) => {
                  mockDb.deletes.push({ table, filters: [...filters], lt: [col2, val2] });
                  return Promise.resolve({ error: null });
                },
              };
            },
          }),
          insert: (payload: Record<string, unknown>) => {
            mockDb.inserts.push({ table, payload });
            return Promise.resolve({ error: mockDb.lockInsertError });
          },
        };
      }

      if (table === "zoho_connections") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockDb.freshConnection, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (col: string, val: unknown) => {
              mockDb.updates.push({ table, payload, filters: [[col, val]] });
              return Promise.resolve({ error: mockDb.updateError });
            },
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

describe("stripHtml", () => {
  it("removes tags, style, and script blocks, collapsing whitespace", async () => {
    const { stripHtml } = await import("./zohoApiHelpers");
    const html = "<style>.x{color:red}</style><p>Hello   <b>World</b></p><script>evil()</script>";
    expect(stripHtml(html)).toBe("Hello World");
  });
});

describe("refreshZohoToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockDb.deletes = [];
    mockDb.inserts = [];
    mockDb.updates = [];
    mockDb.lockInsertError = null;
    mockDb.freshConnection = null;
    mockDb.updateError = null;
  });

  it("does not refresh before the actual expiry time", async () => {
    const { needsZohoTokenRefresh } = await import("./zohoApiHelpers");
    const now = Date.parse("2026-07-20T14:19:39.000Z");
    const expiresFiveMinutesLater = "2026-07-20T14:24:34.220Z";

    expect(needsZohoTokenRefresh(expiresFiveMinutesLater, now)).toBe(false);
    expect(needsZohoTokenRefresh("2026-07-20T14:19:38.000Z", now)).toBe(true);
    expect(needsZohoTokenRefresh("not-a-date", now)).toBe(true);
  });

  it("returns the new access token on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "new-token", expires_in: 3600 }),
      }),
    );

    const { refreshZohoToken } = await import("./zohoApiHelpers");
    const token = await refreshZohoToken(
      { zoho_account_id: "acct-1", refresh_token: "ref" },
      "cid",
      "secret",
      "https://accounts.zoho.test",
    );

    expect(token).toBe("new-token");
    expect(mockDb.inserts).toHaveLength(1);
    expect(mockDb.updates).toHaveLength(1);
    expect(mockDb.deletes.at(-1)?.filters.map(([col]) => col)).toEqual([
      "lock_key",
      "owner_token",
    ]);
  });

  it("does not call Zoho when another loop already refreshed the token", async () => {
    mockDb.lockInsertError = { code: "23505", message: "duplicate key" };
    mockDb.freshConnection = {
      access_token: "fresh-token",
      access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      refresh_token: "ref",
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { refreshZohoToken } = await import("./zohoApiHelpers");
    const token = await refreshZohoToken(
      { zoho_account_id: "acct-1", refresh_token: "ref" },
      "cid",
      "secret",
      "https://accounts.zoho.test",
    );

    expect(token).toBe("fresh-token");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockDb.updates).toHaveLength(0);
  });

  it("fails fast on refresh lock contention instead of hammering Zoho", async () => {
    mockDb.lockInsertError = { code: "23505", message: "duplicate key" };
    mockDb.freshConnection = {
      access_token: "expired-token",
      access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
      refresh_token: "ref",
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { refreshZohoToken } = await import("./zohoApiHelpers");
    await expect(
      refreshZohoToken(
        { zoho_account_id: "acct-1", refresh_token: "ref" },
        "cid",
        "secret",
        "https://accounts.zoho.test",
      ),
    ).rejects.toThrow("already in progress");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("worker Zoho paths do not use the old five-minute refresh buffer", () => {
    const files = ["syncEmails.ts", "classifyEmails.ts", "emailPreview.ts"];

    for (const file of files) {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      expect(source).toContain("needsZohoTokenRefresh");
      expect(source).not.toContain("5 * 60 * 1000");
    }
  });

  it("throws safely and cools down after a provider refresh failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "invalid_client", status: 401 }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { refreshZohoToken } = await import("./zohoApiHelpers");
    await expect(
      refreshZohoToken({ zoho_account_id: "acct-1", refresh_token: "ref" }, "cid", "secret", "https://accounts.zoho.test"),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(
      refreshZohoToken({ zoho_account_id: "acct-1", refresh_token: "ref" }, "cid", "secret", "https://accounts.zoho.test"),
    ).rejects.toThrow("cooling down");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
