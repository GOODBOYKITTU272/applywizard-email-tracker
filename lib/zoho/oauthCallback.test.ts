/**
 * Unit tests for GET /api/zoho/callback route.
 * Tests account selection, mailbox matching, signed-state verification, and
 * safe failure. No live Zoho calls, no Supabase writes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

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
const OAUTH_STATE_SECRET = "zoho-oauth-state-test-secret-32-bytes-minimum!!";

/** Builds a real, validly signed state cookie value via the production helper. */
async function stateCookie(
  mailbox: string,
  options: { recovery?: boolean; now?: number } = {},
): Promise<string> {
  const { createZohoOAuthState } = await import("./oauthState");
  const token = createZohoOAuthState(
    { csrf: CSRF, mailbox, recovery: options.recovery ?? false },
    options.now,
  );
  return `zoho_oauth_state=${encodeURIComponent(token)}`;
}

function legacyCookie(): string {
  // Pre-mailbox-targeting format — plain UUID, no signature.
  return `zoho_oauth_state=${CSRF}`;
}

function unsignedJsonCookie(mailbox: string, recovery = false): string {
  // The exact insecure format this fix replaces — must now be rejected outright.
  return `zoho_oauth_state=${encodeURIComponent(JSON.stringify({ csrf: CSRF, mailbox, recovery }))}`;
}

/** Flips one character in the signed token's payload segment without re-signing. */
async function tamperedMailboxCookie(newMailbox: string): Promise<string> {
  const raw = await stateCookie("tracker@applywizard.ai");
  const token = decodeURIComponent(raw.split("=")[1]);
  const [version, encodedPayload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  claims.mailbox = newMailbox;
  const tamperedPayload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `zoho_oauth_state=${encodeURIComponent(`${version}.${tamperedPayload}.${signature}`)}`;
}

async function tamperedRecoveryCookie(): Promise<string> {
  const raw = await stateCookie("tracker@applywizard.ai", { recovery: false });
  const token = decodeURIComponent(raw.split("=")[1]);
  const [version, encodedPayload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  claims.recovery = true;
  const tamperedPayload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `zoho_oauth_state=${encodeURIComponent(`${version}.${tamperedPayload}.${signature}`)}`;
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

function makeFetchMockNoRefreshToken(accounts: unknown[]) {
  return vi.fn().mockImplementation((url: string) => {
    if ((url as string).includes("/oauth/v2/token")) {
      // Zoho's documented behavior on a repeat, already-granted authorization:
      // access_token only, refresh_token omitted.
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ access_token: "acc-new", expires_in: 3600 }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: accounts }) });
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

function makeCallbackRequest(cookie: string, state = CSRF): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/zoho/callback?code=CODE&state=${state}`,
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
  process.env.ZOHO_OAUTH_STATE_SECRET = OAUTH_STATE_SECRET;
}

function clearEnvVars() {
  for (const k of [
    "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REDIRECT_URI",
    "ZOHO_ACCOUNTS_BASE_URL", "ZOHO_MAIL_BASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ZOHO_OAUTH_STATE_SECRET",
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
    const res = await GET(makeCallbackRequest(await stateCookie("tracker@applywizard.ai")));

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
    const res = await GET(makeCallbackRequest(await stateCookie("tracker@applywizard.ai")));

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
    const res = await GET(makeCallbackRequest(await stateCookie("tracker@applywizard.ai")));

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
    const res = await GET(makeCallbackRequest(await stateCookie("")));

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email_address: "ramakrishna@applywizard.ai" }),
      { onConflict: "email_address" },
    );

    vi.unstubAllGlobals();
  });

  it("normalizes returned primaryEmailAddress case before comparing", async () => {
    vi.stubGlobal("fetch", makeFetchMock([
      zohoAccount("Tracker@ApplyWizard.AI"),   // Zoho returns mixed case
    ]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(await stateCookie("tracker@applywizard.ai")));

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ email_address: "tracker@applywizard.ai" }),
      { onConflict: "email_address" },
    );
    vi.unstubAllGlobals();
  });

  it("a validly signed state with a mismatched csrf is rejected without calling upsert", async () => {
    const { createZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState({ csrf: "11111111-1111-4111-8111-111111111111", mailbox: "", recovery: false });
    const badCookie = `zoho_oauth_state=${encodeURIComponent(token)}`;

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(badCookie)); // request still carries the original CSRF constant

    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("requested mailbox is not present in any log — upsert payload has email_address only", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", makeFetchMock([
      zohoAccount("tracker@applywizard.ai"),
    ]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    await GET(makeCallbackRequest(await stateCookie("tracker@applywizard.ai")));

    // No log line should contain the full mailbox address
    const allLogged = logSpy.mock.calls.flat().map(String).join(" ");
    expect(allLogged).not.toContain("tracker@applywizard.ai");

    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("normal mode preserves an existing refresh token and reports that honestly", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { refresh_token: "old-good-token" }, error: null });
    vi.stubGlobal("fetch", makeFetchMockNoRefreshToken([zohoAccount("tracker@applywizard.ai")]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(await stateCookie("tracker@applywizard.ai")));

    expect(res.status).toBe(200);
    const body = await res.json() as {
      message: string;
      new_refresh_token_received: boolean;
      existing_refresh_token_preserved: boolean;
    };
    expect(body.message).toContain("Zoho OAuth complete");
    expect(body.new_refresh_token_received).toBe(false);
    expect(body.existing_refresh_token_preserved).toBe(true);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ refresh_token: "old-good-token" }),
      { onConflict: "email_address" },
    );

    // Never in a response body.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("old-good-token");

    vi.unstubAllGlobals();
  });
});

describe("GET /api/zoho/callback — signed state integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnvVars();
  });
  afterEach(clearEnvVars);

  it("accepts a valid signed state and proceeds to token exchange", async () => {
    const fetchMock = makeFetchMock([zohoAccount("tracker@applywizard.ai")]);
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(await stateCookie("tracker@applywizard.ai")));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects a tampered mailbox — zero token exchange, zero writes", async () => {
    const fetchMock = makeFetchMock([zohoAccount("attacker@applywizard.ai")]);
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(await tamperedMailboxCookie("attacker@applywizard.ai")));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Invalid OAuth state");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("rejects a tampered recovery flag — zero token exchange, zero writes", async () => {
    const fetchMock = makeFetchMock([zohoAccount("tracker@applywizard.ai")]);
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(await tamperedRecoveryCookie()));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("rejects an expired state — zero token exchange, zero writes", async () => {
    const fetchMock = makeFetchMock([zohoAccount("tracker@applywizard.ai")]);
    vi.stubGlobal("fetch", fetchMock);

    // Signed 20 minutes ago — the 10-minute validity window has long passed.
    const expiredCookie = await stateCookie("tracker@applywizard.ai", { now: Date.now() - 20 * 60_000 });

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(expiredCookie));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("returns a safe 400 without leaking internal crypto detail", async () => {
    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(await tamperedMailboxCookie("attacker@applywizard.ai")));

    const body = await res.json() as { error: string };
    expect(body.error).toBe("Invalid OAuth state. Please start the login flow again.");
    for (const forbidden of ["hmac", "signature", "base64", "secret", "crypto"]) {
      expect(body.error.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("rejects the legacy plain-UUID cookie outright — no backward compatibility for unsigned state", async () => {
    const fetchMock = makeFetchMock([zohoAccount("ramakrishna@applywizard.ai")]);
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(legacyCookie()));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("rejects the previous unsigned-JSON cookie format outright — that format was the security issue", async () => {
    const fetchMock = makeFetchMock([zohoAccount("tracker@applywizard.ai")]);
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(makeCallbackRequest(unsignedJsonCookie("tracker@applywizard.ai")));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("GET /api/zoho/callback — recovery mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnvVars();
  });
  afterEach(clearEnvVars);

  it("stores a newly returned refresh token and reports recovery success", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { refresh_token: "old-dead-token" }, error: null });
    vi.stubGlobal("fetch", makeFetchMock([zohoAccount("tracker@applywizard.ai")]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(
      makeCallbackRequest(await stateCookie("tracker@applywizard.ai", { recovery: true })),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      message: string;
      new_refresh_token_received: boolean;
      connection_updated: boolean;
    };
    expect(body).toEqual({
      message: "Zoho OAuth recovery completed.",
      new_refresh_token_received: true,
      connection_updated: true,
    });

    // Recovery must never carry the old token forward.
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ refresh_token: "ref", email_address: "tracker@applywizard.ai" }),
      { onConflict: "email_address" },
    );
    const upsertPayload = mockUpsert.mock.calls[0][0] as { refresh_token: string };
    expect(upsertPayload.refresh_token).not.toBe("old-dead-token");

    vi.unstubAllGlobals();
  });

  it("rejects recovery and never writes anything when Zoho omits a new refresh token", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { refresh_token: "old-dead-token" }, error: null });
    vi.stubGlobal("fetch", makeFetchMockNoRefreshToken([zohoAccount("tracker@applywizard.ai")]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(
      makeCallbackRequest(await stateCookie("tracker@applywizard.ai", { recovery: true })),
    );

    expect(res.status).not.toBe(200);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Zoho did not issue a new refresh token");
    expect(body.error).toContain("Recovery was not completed");

    // The old (possibly-dead) token must never be silently kept in recovery mode.
    expect(mockUpsert).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("recovery mode still enforces exact mailbox targeting — no fallback to another account", async () => {
    vi.stubGlobal("fetch", makeFetchMock([zohoAccount("ramakrishna@applywizard.ai")]));

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(
      makeCallbackRequest(await stateCookie("tracker@applywizard.ai", { recovery: true })),
    );

    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("recovery success response never contains token values", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    // Distinguishable, unmistakable-if-leaked values — unlike "acc"/"ref", these
    // cannot collide with legitimate field names such as new_refresh_token_received.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if ((url as string).includes("/oauth/v2/token")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                access_token: "SECRET-ACCESS-TOKEN-VALUE",
                refresh_token: "SECRET-REFRESH-TOKEN-VALUE",
                expires_in: 3600,
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [zohoAccount("tracker@applywizard.ai")] }),
        });
      }),
    );

    const { GET } = await import("../../app/api/zoho/callback/route");
    const res = await GET(
      makeCallbackRequest(await stateCookie("tracker@applywizard.ai", { recovery: true })),
    );

    const raw = await res.text();
    expect(raw).not.toContain("SECRET-ACCESS-TOKEN-VALUE");
    expect(raw).not.toContain("SECRET-REFRESH-TOKEN-VALUE");

    vi.unstubAllGlobals();
  });
});
