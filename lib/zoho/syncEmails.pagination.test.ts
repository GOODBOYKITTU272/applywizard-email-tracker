/**
 * Pagination behavior tests for syncEmails.
 * Tests multi-page fetching, oldest-first ordering, max-per-run cap,
 * duplicate safety, and backlog continuation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockConnectionSingle = vi.fn();
const mockExistingIn = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: (table: string) => {
      if (table === "zoho_connections") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: mockConnectionSingle }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      // zoho_email_metadata
      return {
        select: () => ({
          eq: () => ({ in: mockExistingIn }),
        }),
        upsert: mockUpsert,
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

function makeMessages(count: number, startIndex = 0) {
  return Array.from({ length: count }, (_, i) => ({
    messageId: `msg-${startIndex + i}`,
    sender: "client@example.com",
    subject: `Email ${startIndex + i}`,
    receivedTime: Date.now() - (startIndex + i) * 1000,
    folderName: "Inbox",
    folderId: "folder-1",
  }));
}

function makeFetchPage(pages: unknown[][]) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const data = pages[call] ?? [];
    call++;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: { code: 200 }, data }),
    });
  });
}

function setEnv(overrides: Record<string, string> = {}) {
  process.env.ZOHO_CLIENT_ID = "cid";
  process.env.ZOHO_CLIENT_SECRET = "csecret";
  process.env.ZOHO_ACCOUNTS_BASE_URL = "https://accounts.zoho.test";
  process.env.ZOHO_MAIL_BASE_URL = "https://mail.zoho.test";
  process.env.ZOHO_SYNC_MAILBOX = "tracker@applywizard.ai";
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
}

function clearEnv() {
  for (const k of [
    "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_ACCOUNTS_BASE_URL",
    "ZOHO_MAIL_BASE_URL", "ZOHO_SYNC_MAILBOX",
    "ZOHO_SYNC_PAGE_SIZE", "ZOHO_SYNC_MAX_PER_RUN",
  ]) delete process.env[k];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("syncEmails — pagination behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockConnectionSingle.mockResolvedValue({ data: TRACKER_CONNECTION, error: null });
    mockExistingIn.mockResolvedValue({ data: [], error: null });
    mockUpsert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
  });

  it("fetches more than one page when first page is full", async () => {
    setEnv({ ZOHO_SYNC_PAGE_SIZE: "3", ZOHO_SYNC_MAX_PER_RUN: "10" });
    // Page 1: 3 messages (full), page 2: 2 messages (partial → end)
    vi.stubGlobal("fetch", makeFetchPage([makeMessages(3), makeMessages(2, 3)]));

    const { syncEmails } = await import("./syncEmails");
    const result = await syncEmails();

    expect(result.fetched).toBe(5);
    expect(result.has_more).toBe(false);
    // fetch called twice (two pages)
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("older emails are processed before newer emails (start=0 oldest-first via sortorder=asc)", async () => {
    setEnv({ ZOHO_SYNC_PAGE_SIZE: "5" });
    const capturedUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      capturedUrls.push(url);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: { code: 200 }, data: [] }),
      });
    }));

    const { syncEmails } = await import("./syncEmails");
    await syncEmails();

    // First request must use start=0 with sortorder=asc
    expect(capturedUrls[0]).toContain("start=0");
    expect(capturedUrls[0]).toContain("sortorder=asc");
  });

  it("duplicate message IDs are not inserted twice — upsert uses onConflict", async () => {
    setEnv({ ZOHO_SYNC_PAGE_SIZE: "5" });
    const msgs = makeMessages(3);
    // All three already exist in Supabase
    mockExistingIn.mockResolvedValue({ data: msgs.map(m => ({ message_id: m.messageId })), error: null });
    vi.stubGlobal("fetch", makeFetchPage([msgs]));

    const { syncEmails } = await import("./syncEmails");
    const result = await syncEmails();

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(3);
    // Upsert still called — onConflict handles idempotency at DB level
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("max-per-run stops safely and reports has_more=true when last page was full", async () => {
    // maxPerRun=3, pageSize=3 — one full page hits the cap
    setEnv({ ZOHO_SYNC_PAGE_SIZE: "3", ZOHO_SYNC_MAX_PER_RUN: "3" });
    vi.stubGlobal("fetch", makeFetchPage([makeMessages(3)]));

    const { syncEmails } = await import("./syncEmails");
    const result = await syncEmails();

    expect(result.fetched).toBe(3);
    expect(result.has_more).toBe(true);
    // Only one page fetched — stopped at cap
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("next run continues remaining backlog — already-seen emails counted as updated not inserted", async () => {
    setEnv({ ZOHO_SYNC_PAGE_SIZE: "5" });
    const msgs = makeMessages(3);
    // Simulate: previous run already stored these messages
    mockExistingIn.mockResolvedValue({ data: msgs.map(m => ({ message_id: m.messageId })), error: null });
    vi.stubGlobal("fetch", makeFetchPage([msgs]));

    const { syncEmails } = await import("./syncEmails");
    const result = await syncEmails();

    // All updated (not re-inserted) — idempotent
    expect(result.updated).toBe(3);
    expect(result.inserted).toBe(0);
    expect(result.has_more).toBe(false);
  });

  it("offset advances correctly across pages — start param increases by page count", async () => {
    setEnv({ ZOHO_SYNC_PAGE_SIZE: "2", ZOHO_SYNC_MAX_PER_RUN: "10" });
    const capturedUrls: string[] = [];
    let call = 0;
    const pages = [makeMessages(2), makeMessages(2, 2), makeMessages(1, 4)];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      capturedUrls.push(url);
      const data = pages[call] ?? [];
      call++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: { code: 200 }, data }),
      });
    }));

    const { syncEmails } = await import("./syncEmails");
    const result = await syncEmails();

    expect(result.fetched).toBe(5);
    // start values: 0, 2, 4
    expect(capturedUrls[0]).toContain("start=0");
    expect(capturedUrls[1]).toContain("start=2");
    expect(capturedUrls[2]).toContain("start=4");
  });
});
