/**
 * Pagination behavior tests for syncEmails.
 * Verifies recent-first replay ingestion, checkpoint persistence, and dedupe.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockConnectionMaybeSingle = vi.fn();
const mockCheckpointMaybeSingle = vi.fn();
const mockCheckpointUpsert = vi.fn();
const mockExistingIn = vi.fn();
const mockMetadataUpsert = vi.fn();

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "zoho_connections") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: mockConnectionMaybeSingle,
              }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }

      if (table === "zoho_sync_checkpoints") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: mockCheckpointMaybeSingle,
            }),
          }),
          upsert: mockCheckpointUpsert,
        };
      }

      return {
        select: () => ({
          eq: () => ({
            in: mockExistingIn,
          }),
        }),
        upsert: mockMetadataUpsert,
      };
    },
  }),
}));

const TRACKER_CONNECTION = {
  id: "conn-tracker",
  zoho_account_id: "acct-tracker",
  email_address: "tracker@applywizard.ai",
  access_token: "tok",
  access_token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
  refresh_token: "ref",
  status: "active",
};

function setEnv(overrides: Record<string, string> = {}) {
  process.env.ZOHO_CLIENT_ID = "cid";
  process.env.ZOHO_CLIENT_SECRET = "csecret";
  process.env.ZOHO_ACCOUNTS_BASE_URL = "https://accounts.zoho.test";
  process.env.ZOHO_MAIL_BASE_URL = "https://mail.zoho.test";
  process.env.ZOHO_SYNC_MAILBOX = "tracker@applywizard.ai";
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
}

function clearEnv() {
  for (const key of [
    "ZOHO_CLIENT_ID",
    "ZOHO_CLIENT_SECRET",
    "ZOHO_ACCOUNTS_BASE_URL",
    "ZOHO_MAIL_BASE_URL",
    "ZOHO_SYNC_MAILBOX",
    "ZOHO_SYNC_PAGE_SIZE",
    "ZOHO_SYNC_MAX_PER_RUN",
    "ZOHO_SYNC_REPLAY_WINDOW_MINUTES",
  ]) {
    delete process.env[key];
  }
}

function makeMessages(ids: string[], startedAt = Date.parse("2026-06-30T04:00:00.000Z")) {
  return ids.map((id, index) => ({
    messageId: id,
    sender: "client@example.com",
    subject: `Email ${id}`,
    receivedTime: startedAt - index * 1000,
    folderName: "Inbox",
    folderId: "folder-1",
    hasAttachment: "0",
  }));
}

describe("syncEmails recent replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockConnectionMaybeSingle.mockResolvedValue({ data: TRACKER_CONNECTION, error: null });
    mockCheckpointMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockCheckpointUpsert.mockResolvedValue({ error: null });
    mockExistingIn.mockResolvedValue({ data: [], error: null });
    mockMetadataUpsert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearEnv();
  });

  it("prioritizes newest pages and no longer requests sortorder=asc", async () => {
    setEnv({ ZOHO_SYNC_PAGE_SIZE: "3", ZOHO_SYNC_MAX_PER_RUN: "3" });
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

    expect(capturedUrls[0]).toContain("start=0");
    expect(capturedUrls[0]).not.toContain("sortorder=asc");
  });

  it("persists the checkpoint from the newest message seen on the run", async () => {
    setEnv({ ZOHO_SYNC_PAGE_SIZE: "2", ZOHO_SYNC_MAX_PER_RUN: "2" });
    const page = makeMessages(["msg-200", "msg-199"]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: { code: 200 }, data: page }),
    }));

    const { syncEmails } = await import("./syncEmails");
    await syncEmails();

    expect(mockCheckpointUpsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          mailbox_email: "tracker@applywizard.ai",
          last_seen_message_id: "msg-200",
        }),
      ]),
      expect.anything(),
    );
  });

  it("replays recent pages after the checkpoint and dedupes already-seen messages", async () => {
    setEnv({
      ZOHO_SYNC_PAGE_SIZE: "2",
      ZOHO_SYNC_MAX_PER_RUN: "4",
      ZOHO_SYNC_REPLAY_WINDOW_MINUTES: "30",
    });
    mockCheckpointMaybeSingle.mockResolvedValue({
      data: {
        mailbox_email: "tracker@applywizard.ai",
        last_seen_message_id: "msg-101",
        last_seen_received_at: "2026-06-30T04:00:00.000Z",
        last_successful_sync_at: "2026-06-30T04:05:00.000Z",
      },
      error: null,
    });

    const pages = [
      makeMessages(["msg-101", "msg-100"]),
      makeMessages(["msg-099"], Date.parse("2026-06-30T03:50:00.000Z")),
    ];

    let fetchIndex = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: { code: 200 }, data: pages[fetchIndex++] ?? [] }),
    })));

    mockExistingIn
      .mockResolvedValueOnce({
        data: [{ message_id: "msg-101" }, { message_id: "msg-100" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ message_id: "msg-099" }],
        error: null,
      });

    const { syncEmails } = await import("./syncEmails");
    const result = await syncEmails();

    expect(result.inserted).toBe(0);
    expect(result.updated).toBe(3);
    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it("uses a time-based replay overlap window instead of a fixed two-page stop", async () => {
    setEnv({
      ZOHO_SYNC_PAGE_SIZE: "2",
      ZOHO_SYNC_MAX_PER_RUN: "6",
      ZOHO_SYNC_REPLAY_WINDOW_MINUTES: "15",
    });
    mockCheckpointMaybeSingle.mockResolvedValue({
      data: {
        mailbox_email: "tracker@applywizard.ai",
        last_seen_message_id: "msg-301",
        last_seen_received_at: "2026-06-30T04:00:00.000Z",
        last_successful_sync_at: "2026-06-30T04:10:00.000Z",
      },
      error: null,
    });

    const pages = [
      makeMessages(["msg-301", "msg-300"], Date.parse("2026-06-30T04:09:00.000Z")),
      makeMessages(["msg-299", "msg-298"], Date.parse("2026-06-30T03:57:00.000Z")),
      makeMessages(["msg-297"], Date.parse("2026-06-30T03:40:00.000Z")),
    ];

    let fetchIndex = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: { code: 200 }, data: pages[fetchIndex++] ?? [] }),
    })));

    const { syncEmails } = await import("./syncEmails");
    await syncEmails();

    expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  });

  it("keeps replay-window env default and bounds in place", () => {
    const src = readFileSync(resolve(__dirname, "syncEmails.ts"), "utf8");

    expect(src).toContain("const DEFAULT_REPLAY_WINDOW_MINUTES = 30");
    expect(src).toContain("process.env.ZOHO_SYNC_REPLAY_WINDOW_MINUTES");
    expect(src).toContain("Math.min(\n    240,");
    expect(src).toContain("Math.max(\n      1,");
  });

  it("never persists raw body text, raw headers, OTPs, or attachment contents in metadata upserts", async () => {
    setEnv({ ZOHO_SYNC_PAGE_SIZE: "1", ZOHO_SYNC_MAX_PER_RUN: "1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: { code: 200 }, data: makeMessages(["msg-otp"]) }),
    }));

    const { syncEmails } = await import("./syncEmails");
    await syncEmails();

    const firstCall = mockMetadataUpsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(firstCall[0]).not.toHaveProperty("content");
    expect(firstCall[0]).not.toHaveProperty("body");
    expect(firstCall[0]).not.toHaveProperty("raw_headers");
    expect(firstCall[0]).not.toHaveProperty("otp");
    expect(firstCall[0]).not.toHaveProperty("attachments");
  });
});
