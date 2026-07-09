import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
type MaybeSingleResult = { data: Row | null; error: { message: string } | null };
type MutationResult = { data: { id: string } | null; error: { message: string } | null };
type UpdateResult = { error: { message: string } | null };

let insertResult: MutationResult;
let sessionSelectResult: MaybeSingleResult;
let userSelectResult: MaybeSingleResult;
let updateResult: UpdateResult;

interface CallRecord {
  type: "insert" | "select.eq" | "update" | "update.eq" | "update.is";
  table: string;
  payload?: Row;
  column?: string;
  value?: string;
}

let calls: CallRecord[];

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: (row: Row) => {
        calls.push({ type: "insert", table, payload: row });
        return {
          select: () => ({
            single: async () => insertResult,
          }),
        };
      },
      select: () => ({
        eq: (column: string, value: string) => {
          calls.push({ type: "select.eq", table, column, value });
          return {
            maybeSingle: async () => (table === "dashboard_sessions" ? sessionSelectResult : userSelectResult),
          };
        },
      }),
      update: (payload: Row) => {
        calls.push({ type: "update", table, payload });
        const chain = {
          eq: (column: string, value: string) => {
            calls.push({ type: "update.eq", table, column, value });
            return chain;
          },
          is: (column: string, value: null) => {
            calls.push({ type: "update.is", table, column, value: String(value) });
            return chain;
          },
          then: (resolve: (value: UpdateResult) => void) => resolve(updateResult),
        };
        return chain;
      },
    }),
  }),
}));

const ACTIVE_USER_ROW: Row = {
  id: "22222222-2222-2222-2222-222222222222",
  email: "admin@applywizz.ai",
  role: "admin_ceo",
  status: "active",
  totp_enabled: false,
};

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DASHBOARD_SESSION_SECRET", "session-secret");

  calls = [];
  insertResult = { data: { id: "11111111-1111-1111-1111-111111111111" }, error: null };
  sessionSelectResult = {
    data: {
      id: "11111111-1111-1111-1111-111111111111",
      user_id: "22222222-2222-2222-2222-222222222222",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      revoked_at: null,
    },
    error: null,
  };
  userSelectResult = { data: { ...ACTIVE_USER_ROW }, error: null };
  updateResult = { error: null };
});

const RAW_TOKEN = "raw-session-token-fake";

describe("createDashboardSession", () => {
  it("stores the hashed token, never the raw token", async () => {
    const { createDashboardSession } = await import("./sessionStore");
    const { hashSessionToken } = await import("./session");

    const result = await createDashboardSession({
      userId: "22222222-2222-2222-2222-222222222222",
      rawToken: RAW_TOKEN,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(result).toEqual({ ok: true, sessionId: "11111111-1111-1111-1111-111111111111" });

    const insertCall = calls.find((call) => call.type === "insert");
    expect(insertCall?.payload?.session_hash).toBe(hashSessionToken(RAW_TOKEN));
    expect(insertCall?.payload?.session_hash).not.toBe(RAW_TOKEN);
    expect(JSON.stringify(calls)).not.toContain(RAW_TOKEN);
  });

  it("returns ok:false on insert error", async () => {
    insertResult = { data: null, error: { message: "insert failed" } };
    const { createDashboardSession } = await import("./sessionStore");

    await expect(
      createDashboardSession({
        userId: "22222222-2222-2222-2222-222222222222",
        rawToken: RAW_TOKEN,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).resolves.toEqual({ ok: false });
  });
});

describe("getDashboardSessionByToken", () => {
  it("returns the active session and user for a valid token", async () => {
    const { getDashboardSessionByToken } = await import("./sessionStore");

    const result = await getDashboardSessionByToken(RAW_TOKEN);

    expect(result).toEqual({
      ok: true,
      session: {
        id: "11111111-1111-1111-1111-111111111111",
        userId: "22222222-2222-2222-2222-222222222222",
        expiresAt: sessionSelectResult.data!.expires_at,
        revokedAt: null,
        user: {
          id: "22222222-2222-2222-2222-222222222222",
          email: "admin@applywizz.ai",
          role: "admin_ceo",
          status: "active",
          totpEnabled: false,
        },
      },
    });
  });

  it("never selects or returns totp_secret_encrypted", async () => {
    const { getDashboardSessionByToken } = await import("./sessionStore");

    const result = await getDashboardSessionByToken(RAW_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.session.user)).toEqual(["id", "email", "role", "status", "totpEnabled"]);
    }
    const userSelectCall = calls.find((call) => call.type === "select.eq" && call.table === "dashboard_users");
    expect(userSelectCall).toBeDefined();
    expect(JSON.stringify(calls)).not.toContain("totp_secret_encrypted");
  });

  it("returns ok:false when the session is not found", async () => {
    sessionSelectResult = { data: null, error: null };
    const { getDashboardSessionByToken } = await import("./sessionStore");

    await expect(getDashboardSessionByToken(RAW_TOKEN)).resolves.toEqual({ ok: false });
  });

  it("returns ok:false on a session query error", async () => {
    sessionSelectResult = { data: null, error: { message: "db unavailable" } };
    const { getDashboardSessionByToken } = await import("./sessionStore");

    await expect(getDashboardSessionByToken(RAW_TOKEN)).resolves.toEqual({ ok: false });
  });

  it("returns ok:false when the session is revoked", async () => {
    sessionSelectResult = {
      data: { ...sessionSelectResult.data, revoked_at: new Date().toISOString() },
      error: null,
    };
    const { getDashboardSessionByToken } = await import("./sessionStore");

    await expect(getDashboardSessionByToken(RAW_TOKEN)).resolves.toEqual({ ok: false });
  });

  it("returns ok:false when the session has expired", async () => {
    sessionSelectResult = {
      data: { ...sessionSelectResult.data, expires_at: new Date(Date.now() - 60_000).toISOString() },
      error: null,
    };
    const { getDashboardSessionByToken } = await import("./sessionStore");

    await expect(getDashboardSessionByToken(RAW_TOKEN)).resolves.toEqual({ ok: false });
  });

  it("returns ok:false when the user is disabled", async () => {
    userSelectResult = { data: { ...ACTIVE_USER_ROW, status: "disabled" }, error: null };
    const { getDashboardSessionByToken } = await import("./sessionStore");

    await expect(getDashboardSessionByToken(RAW_TOKEN)).resolves.toEqual({ ok: false });
  });

  it("returns ok:false when the user is missing", async () => {
    userSelectResult = { data: null, error: null };
    const { getDashboardSessionByToken } = await import("./sessionStore");

    await expect(getDashboardSessionByToken(RAW_TOKEN)).resolves.toEqual({ ok: false });
  });

  it("does not fail the lookup when the best-effort last_seen_at touch errors", async () => {
    updateResult = { error: { message: "update failed" } };
    const { getDashboardSessionByToken } = await import("./sessionStore");

    const result = await getDashboardSessionByToken(RAW_TOKEN);
    expect(result.ok).toBe(true);
  });
});

describe("revokeDashboardSession", () => {
  it("hashes the token and updates by session_hash, not the raw token", async () => {
    const { revokeDashboardSession } = await import("./sessionStore");
    const { hashSessionToken } = await import("./session");

    await expect(revokeDashboardSession(RAW_TOKEN)).resolves.toEqual({ ok: true });

    const eqCall = calls.find((call) => call.type === "update.eq" && call.column === "session_hash");
    expect(eqCall?.value).toBe(hashSessionToken(RAW_TOKEN));
    const isCall = calls.find((call) => call.type === "update.is");
    expect(isCall).toEqual({ type: "update.is", table: "dashboard_sessions", column: "revoked_at", value: "null" });
    expect(JSON.stringify(calls)).not.toContain(RAW_TOKEN);
  });

  it("returns ok:false on a DB error", async () => {
    updateResult = { error: { message: "update failed" } };
    const { revokeDashboardSession } = await import("./sessionStore");

    await expect(revokeDashboardSession(RAW_TOKEN)).resolves.toEqual({ ok: false });
  });
});

describe("revokeDashboardSessionsForUser", () => {
  it("updates all active sessions for the given user", async () => {
    const { revokeDashboardSessionsForUser } = await import("./sessionStore");

    await expect(revokeDashboardSessionsForUser("22222222-2222-2222-2222-222222222222")).resolves.toEqual({
      ok: true,
    });

    const eqCall = calls.find((call) => call.type === "update.eq" && call.column === "user_id");
    expect(eqCall?.value).toBe("22222222-2222-2222-2222-222222222222");
    const isCall = calls.find((call) => call.type === "update.is");
    expect(isCall?.column).toBe("revoked_at");
  });

  it("returns ok:false on a DB error", async () => {
    updateResult = { error: { message: "update failed" } };
    const { revokeDashboardSessionsForUser } = await import("./sessionStore");

    await expect(revokeDashboardSessionsForUser("22222222-2222-2222-2222-222222222222")).resolves.toEqual({
      ok: false,
    });
  });
});
