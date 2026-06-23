/**
 * Unit tests for GET /api/zoho/callback route.
 * Tests account selection, mailbox matching, and safe failure.
 * No live Zoho calls, no Supabase writes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
      upsert: mockUpsert,
    }),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const CSRF = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function stateCookie(mailbox: string): string {
  return `zoho_oauth_state=${encodeURIComponent(JSON.stringify({ csrf: CSRF, mailbox }))}`;
}

function legacyCookie(): string {
  // Old plain-UUID format — backward compat
  return `zoho_oauth_state=${CSRF}`;
}

function makeFetchMock(accounts: unknown[]) {
  return vi.fn().mockImplementation((url: string) => {
    if ((url as string).includes("/oauth/v2/token")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "acc",
            refresh_token: "ref",
            expires_in: 3600,
          }),
      });
    }
    // /accounts
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: accounts }),
    });
  });
}

function zohoAccount(primaryEmailAddress: string, overrides = {}) {
  return {
    type: "ZOHO_ACCOUNT",
    enabled: true,
    accountId: "acct-001",
    primaryEmailAddress,
    ...overrides,
  };
}

function makeCallbackRequest(cookie: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/zoho/callback?code=CODE&state=${CSRF}`,
    { headers: { Cookie: cookie } },
  );
}

function setEnvVars() {
  process.env.ZOHO_CLIENT_ID = "cid";
  process.env.ZOHO_CLIENT_SECRET = "csecret";
  process.env.ZOHO_REDIRECT_URI = "http://localhost:3000/api/zoho/callback";
  process.env.ZOHO_ACCOUNTS_BASE_URL = "https://accounts.zoho.test";
  process.env.ZOHO_MAIL_BASE_URL = "https://mail.zoho.test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
}

function clearEnvVars() {
  for (const k of [
    "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REDIRECT_URI",
    "ZOHO_ACCOUNTS_BASE_URL", "ZOHO_MAIL_BASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  ]) delete process.env[k];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/zoho/callback — mailbox targeting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnvVars();
  });
  afterEach(clearEnvVars);

  it("selects exact tracker mailbox when it matches returned account", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      zohoAccount("tracker@applywizard.ai"),
    ]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(stateCookie("tracker@applywizard.ai")));

    expect(res.status).toBe(200);
    const body = await res.json() as { message: string };
    expect(body.message).toContain("Zoho OAuth complete");

    // Upsert must be called with tracker email_address
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email_address: "tracker@applywizard.ai" }),
      { onConflict: "email_address" },
    );

    vi.unstubAllGlobals();
  });

  it("fails safely when requested mailbox is not in returned accounts", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      zohoAccount("ramakrishna@applywizard.ai"),
    ]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(stateCookie("tracker@applywizard.ai")));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Requested mailbox was not returned by Zoho");
    expect(mockUpsert).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("does not fall back to admin mailbox when tracker mailbox is requested", async () => {
    // Admin is first in the list, tracker is absent
    vi.stubGlobal("fetch", makeFetchMock([
      zohoAccount("ramakrishna@applywizard.ai"),
      zohoAccount("other@applywizard.ai"),
    ]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(stateCookie("tracker@applywizard.ai")));

    expect(res.status).toBe(400);
    // Admin must NOT have been upserted
    expect(mockUpsert).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("generic flow (no mailbox) takes first valid account — backward compat", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      zohoAccount("ramakrishna@applywizard.ai"),
    ]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(stateCookie("")));

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email_address: "ramakrishna@applywizard.ai" }),
      { onConflict: "email_address" },
    );

    vi.unstubAllGlobals();
  });

  it("legacy plain-UUID cookie (no mailbox) still works", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      zohoAccount("ramakrishna@applywizard.ai"),
    ]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(legacyCookie()));

    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it("normalizes returned primaryEmailAddress case before comparing", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      zohoAccount("Tracker@ApplyWizard.AI"),   // Zoho returns mixed case
    ]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(stateCookie("tracker@applywizard.ai")));

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email_address: "tracker@applywizard.ai" }),
      { onConflict: "email_address" },
    );
    vi.unstubAllGlobals();
  });

  it("invalid state returns 400 without calling upsert", async () => {
    const badCookie = `zoho_oauth_state=${encodeURIComponent(
      JSON.stringify({ csrf: "wrong-uuid", mailbox: "" }),
    )}`;
    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(badCookie));

    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("requested mailbox is not present in any log — upsert payload has email_address only", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", makeFetchMock([
      zohoAccount("tracker@applywizard.ai"),
    ]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    await GET(makeCallbackRequest(stateCookie("tracker@applywizard.ai")));

    // No log line should contain the full mailbox address
    const allLogged = logSpy.mock.calls.flat().map(String).join(" ");
    expect(allLogged).not.toContain("tracker@applywizard.ai");

    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
