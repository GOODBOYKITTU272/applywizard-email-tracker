/**
 * Unit tests for syncEmails.ts — mailbox targeting safety.
 *
 * Verifies that ZOHO_SYNC_MAILBOX is required and that the connection query
 * targets only the configured mailbox. No live Zoho calls, no Supabase writes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── Shared mock state ─────────────────────────────────────────────────────────

const mockMailboxSingle = vi.fn();
const mockCheckpointSingle = vi.fn();
const mockCheckpointUpsert = vi.fn();

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "zoho_connections") {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              eq: (_col2: string, val2: string) => ({
                maybeSingle: () => mockMailboxSingle(col, val, val2),
              }),
              maybeSingle: () => mockMailboxSingle(col, val),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }

      if (table === "zoho_sync_checkpoints") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () => mockCheckpointSingle(val),
            }),
          }),
          upsert: mockCheckpointUpsert,
        };
      }

      return {
        select: () => ({
          eq: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
        upsert: () => Promise.resolve({ error: null }),
      };
    },
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TRACKER_CONNECTION = {
  id: "conn-tracker",
  zoho_account_id: "acct-tracker",
  email_address: "tracker@applywizard.ai",
  access_token: "tok",
  access_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  refresh_token: "ref",
  status: "active",
};

const ADMIN_CONNECTION = {
  id: "conn-admin",
  zoho_account_id: "acct-admin",
  email_address: "ramakrishna@applywizard.ai",
  access_token: "tok-admin",
  access_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  refresh_token: "ref-admin",
  status: "active",
};

function setEnvVars(mailbox?: string) {
  process.env.ZOHO_CLIENT_ID = "cid";
  process.env.ZOHO_CLIENT_SECRET = "csecret";
  process.env.ZOHO_ACCOUNTS_BASE_URL = "https://accounts.zoho.test";
  process.env.ZOHO_MAIL_BASE_URL = "https://mail.zoho.test";
  if (mailbox !== undefined) {
    process.env.ZOHO_SYNC_MAILBOX = mailbox;
  } else {
    delete process.env.ZOHO_SYNC_MAILBOX;
  }
}

function clearEnvVars() {
  delete process.env.ZOHO_CLIENT_ID;
  delete process.env.ZOHO_CLIENT_SECRET;
  delete process.env.ZOHO_ACCOUNTS_BASE_URL;
  delete process.env.ZOHO_MAIL_BASE_URL;
  delete process.env.ZOHO_SYNC_MAILBOX;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("syncEmails — ZOHO_SYNC_MAILBOX targeting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckpointSingle.mockResolvedValue({ data: null, error: null });
    mockCheckpointUpsert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    clearEnvVars();
  });

  it("throws a clear error when ZOHO_SYNC_MAILBOX is missing", async () => {
    setEnvVars(undefined); // deliberately omit
    const { syncEmails } = await import("./syncEmails");
    await expect(syncEmails()).rejects.toThrow("ZOHO_SYNC_MAILBOX is not configured");
  });

  it("throws a clear error when ZOHO_SYNC_MAILBOX is empty string", async () => {
    setEnvVars("");
    const { syncEmails } = await import("./syncEmails");
    await expect(syncEmails()).rejects.toThrow("ZOHO_SYNC_MAILBOX is not configured");
  });

  it("throws when no active connection exists for the configured mailbox", async () => {
    setEnvVars("tracker@applywizard.ai");
    // Supabase returns null — no matching active connection
    mockMailboxSingle.mockResolvedValue({ data: null, error: null });

    const { syncEmails } = await import("./syncEmails");
    await expect(syncEmails()).rejects.toThrow(
      "No active Zoho connection found for configured sync mailbox",
    );
  });

  it("selects exactly the tracker mailbox connection when configured", async () => {
    setEnvVars("tracker@applywizard.ai");
    // Return tracker connection on first call (connection query),
    // then no existing metadata records on second call
    mockMailboxSingle
      .mockResolvedValueOnce({ data: TRACKER_CONNECTION, error: null });

    // Stub fetch: emails list returns empty so no upsert runs
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ status: { code: 200 }, data: [] }),
      }),
    );

    const { syncEmails } = await import("./syncEmails");
    const result = await syncEmails();

    expect(result.fetched).toBe(0);

    // Verify the Supabase query filtered by the tracker mailbox value.
    // The mock receives (firstEqCol, firstEqVal, secondEqVal) — values only, not column names.
    const calls = mockMailboxSingle.mock.calls;
    const connectionQueryArgs = calls[0]; // ["status", "active", "tracker@applywizard.ai"]
    expect(connectionQueryArgs).toContain("tracker@applywizard.ai");

    vi.unstubAllGlobals();
  });

  it("admin mailbox cannot be selected when tracker mailbox is configured", async () => {
    setEnvVars("tracker@applywizard.ai");
    // Simulate: admin connection exists but tracker does not
    mockMailboxSingle.mockImplementation((_col: string, _val: string, val2?: string) => {
      // Only return a connection if email_address matches tracker
      if (val2 === "tracker@applywizard.ai") {
        return Promise.resolve({ data: null, error: null }); // no tracker connection
      }
      return Promise.resolve({ data: ADMIN_CONNECTION, error: null }); // admin exists
    });

    const { syncEmails } = await import("./syncEmails");
    // Must fail — tracker has no connection, admin must not be selected
    await expect(syncEmails()).rejects.toThrow(
      "No active Zoho connection found for configured sync mailbox",
    );
  });

  it("normalizes ZOHO_SYNC_MAILBOX: uppercase and whitespace are trimmed", async () => {
    setEnvVars("  TRACKER@APPLYWIZARD.AI  ");
    mockMailboxSingle.mockResolvedValueOnce({ data: TRACKER_CONNECTION, error: null });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: { code: 200 }, data: [] }),
      }),
    );

    const { syncEmails } = await import("./syncEmails");
    // Should not throw — normalized value matches tracker connection
    const result = await syncEmails();
    expect(result.fetched).toBe(0);

    // Confirm the query received the normalized value
    const calls = mockMailboxSingle.mock.calls.flat();
    expect(calls).toContain("tracker@applywizard.ai");

    vi.unstubAllGlobals();
  });
});

// ── ZOHO_SYNC_PAGE_SIZE tests ─────────────────────────────────────────────────

describe("syncEmails — ZOHO_SYNC_PAGE_SIZE", () => {
  // Capture the URL passed to fetch so we can assert the limit parameter.
  let capturedUrl: string | null = null;

  function stubFetchCapture() {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: { code: 200 }, data: [] }),
        });
      }),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    capturedUrl = null;
    mockMailboxSingle.mockResolvedValue({ data: TRACKER_CONNECTION, error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ZOHO_CLIENT_ID;
    delete process.env.ZOHO_CLIENT_SECRET;
    delete process.env.ZOHO_ACCOUNTS_BASE_URL;
    delete process.env.ZOHO_MAIL_BASE_URL;
    delete process.env.ZOHO_SYNC_MAILBOX;
    delete process.env.ZOHO_SYNC_PAGE_SIZE;
    delete process.env.ZOHO_SYNC_MAX_PER_RUN;
  });

  it("ZOHO_SYNC_PAGE_SIZE=5 sends limit=5 to Zoho", async () => {
    setEnvVars("tracker@applywizard.ai");
    process.env.ZOHO_SYNC_PAGE_SIZE = "5";
    stubFetchCapture();

    const { syncEmails } = await import("./syncEmails");
    await syncEmails();

    expect(capturedUrl).toContain("limit=5");
  });

  it("missing ZOHO_SYNC_PAGE_SIZE defaults to limit=25", async () => {
    setEnvVars("tracker@applywizard.ai");
    delete process.env.ZOHO_SYNC_PAGE_SIZE;
    stubFetchCapture();

    const { syncEmails } = await import("./syncEmails");
    await syncEmails();

    expect(capturedUrl).toContain("limit=25");
  });

  it("invalid ZOHO_SYNC_PAGE_SIZE (non-numeric string) defaults to limit=25", async () => {
    setEnvVars("tracker@applywizard.ai");
    process.env.ZOHO_SYNC_PAGE_SIZE = "abc";
    stubFetchCapture();

    const { syncEmails } = await import("./syncEmails");
    await syncEmails();

    expect(capturedUrl).toContain("limit=25");
  });

  it("ZOHO_SYNC_PAGE_SIZE above 100 is capped at limit=100", async () => {
    setEnvVars("tracker@applywizard.ai");
    process.env.ZOHO_SYNC_PAGE_SIZE = "999";
    stubFetchCapture();

    const { syncEmails } = await import("./syncEmails");
    await syncEmails();

    expect(capturedUrl).toContain("limit=100");
    expect(capturedUrl).not.toContain("limit=999");
  });

  it("ZOHO_SYNC_PAGE_SIZE=0 is invalid and falls back to default limit=25", async () => {
    // parseInt("0") = 0; 0 || 25 = 25 (falsy zero treated as missing)
    setEnvVars("tracker@applywizard.ai");
    process.env.ZOHO_SYNC_PAGE_SIZE = "0";
    stubFetchCapture();

    const { syncEmails } = await import("./syncEmails");
    await syncEmails();

    expect(capturedUrl).toContain("limit=25");
  });

  it("URL omits sortorder=asc so newest pages are prioritized", async () => {
    setEnvVars("tracker@applywizard.ai");
    stubFetchCapture();

    const { syncEmails } = await import("./syncEmails");
    await syncEmails();

    expect(capturedUrl).not.toContain("sortorder=asc");
  });
});
