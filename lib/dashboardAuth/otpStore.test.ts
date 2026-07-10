import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
type MaybeSingleResult = { data: Row | null; error: { message: string } | null };
type InsertResult = { data: { id: string; expires_at: string } | null; error: { message: string } | null };
type UpdateResult = { data?: Row | null; error: { message: string } | null };

let insertResult: InsertResult;
let otpSelectResult: MaybeSingleResult;
let updateResult: UpdateResult;

interface CallRecord {
  type: "insert" | "insert.select" | "select" | "select.eq" | "update" | "update.eq" | "update.is" | "update.select";
  table: string;
  payload?: Row;
  columns?: string;
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
          select: (columns: string) => {
            calls.push({ type: "insert.select", table, columns });
            return {
            single: async () => insertResult,
          };
          },
        };
      },
      select: (columns: string) => {
        calls.push({ type: "select", table, columns });
        const chain = {
          eq: (column: string, value: string) => {
            calls.push({ type: "select.eq", table, column, value });
            return chain;
          },
          maybeSingle: async () => otpSelectResult,
        };
        return chain;
      },
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
          select: (columns: string) => {
            calls.push({ type: "update.select", table, columns });
            return {
              maybeSingle: async () => updateResult,
            };
          },
          then: (resolve: (value: UpdateResult) => void) => resolve(updateResult),
        };
        return chain;
      },
    }),
  }),
}));

const USER_ID = "22222222-2222-2222-2222-222222222222";
const OTP_ID = "11111111-1111-1111-1111-111111111111";
const RAW_OTP = "123456";
const NOW = new Date("2026-07-10T10:00:00.000Z");

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("DASHBOARD_SESSION_SECRET", "otp-store-secret");
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  calls = [];
  insertResult = {
    data: {
      id: OTP_ID,
      expires_at: "2026-07-10T10:10:00.000Z",
    },
    error: null,
  };
  otpSelectResult = { data: null, error: null };
  updateResult = { data: { id: OTP_ID }, error: null };
});

describe("createDashboardEmailOtp", () => {
  it("stores only the hashed OTP with a 10 minute expiry", async () => {
    const { createDashboardEmailOtp } = await import("./otpStore");
    const { hashOtp } = await import("./otp");

    const result = await createDashboardEmailOtp({ userId: USER_ID, rawOtp: RAW_OTP });

    expect(result).toEqual({ ok: true, otpId: OTP_ID, expiresAt: "2026-07-10T10:10:00.000Z" });

    const insertCall = calls.find((call) => call.type === "insert");
    expect(insertCall?.table).toBe("dashboard_email_otps");
    expect(insertCall?.payload).toMatchObject({
      user_id: USER_ID,
      otp_hash: hashOtp(RAW_OTP),
      expires_at: "2026-07-10T10:10:00.000Z",
      attempt_count: 0,
    });
    expect(insertCall?.payload?.otp_hash).not.toBe(RAW_OTP);
    expect(JSON.stringify(calls)).not.toContain(RAW_OTP);
  });

  it("returns ok:false on insert error", async () => {
    insertResult = { data: null, error: { message: "insert failed" } };
    const { createDashboardEmailOtp } = await import("./otpStore");

    await expect(createDashboardEmailOtp({ userId: USER_ID, rawOtp: RAW_OTP })).resolves.toEqual({ ok: false });
  });
});

describe("verifyDashboardEmailOtp", () => {
  it("marks the OTP used when the raw OTP matches", async () => {
    const { hashOtp } = await import("./otp");
    otpSelectResult = {
      data: {
        id: OTP_ID,
        user_id: USER_ID,
        otp_hash: hashOtp(RAW_OTP),
        expires_at: "2026-07-10T10:10:00.000Z",
        used_at: null,
        attempt_count: 0,
      },
      error: null,
    };
    const { verifyDashboardEmailOtp } = await import("./otpStore");

    await expect(verifyDashboardEmailOtp({ otpId: OTP_ID, rawOtp: RAW_OTP })).resolves.toEqual({
      ok: true,
      userId: USER_ID,
    });

    expect(calls).toContainEqual({
      type: "select",
      table: "dashboard_email_otps",
      columns: "id, user_id, otp_hash, expires_at, used_at, attempt_count",
    });
    expect(calls).toContainEqual({
      type: "select.eq",
      table: "dashboard_email_otps",
      column: "id",
      value: OTP_ID,
    });
    expect(JSON.stringify(calls)).not.toContain('select","table":"dashboard_email_otps","columns":"*"');
    expect(JSON.stringify(calls)).not.toContain(RAW_OTP);

    const updateCall = calls.find((call) => call.type === "update");
    expect(updateCall?.payload?.used_at).toBe("2026-07-10T10:00:00.000Z");
    expect(calls).toContainEqual({ type: "update.eq", table: "dashboard_email_otps", column: "id", value: OTP_ID });
    expect(calls).toContainEqual({ type: "update.is", table: "dashboard_email_otps", column: "used_at", value: "null" });
  });

  it("increments attempts and returns ok:false when the raw OTP does not match", async () => {
    const { hashOtp } = await import("./otp");
    otpSelectResult = {
      data: {
        id: OTP_ID,
        otp_hash: hashOtp("999999"),
        expires_at: "2026-07-10T10:10:00.000Z",
        used_at: null,
        attempt_count: 2,
      },
      error: null,
    };
    const { verifyDashboardEmailOtp } = await import("./otpStore");

    await expect(verifyDashboardEmailOtp({ otpId: OTP_ID, rawOtp: RAW_OTP })).resolves.toEqual({
      ok: false,
      reason: "incorrect",
    });

    const updateCall = calls.find((call) => call.type === "update");
    expect(updateCall?.payload).toEqual({ attempt_count: 3 });
    expect(calls).toContainEqual({ type: "update.eq", table: "dashboard_email_otps", column: "id", value: OTP_ID });
    expect(calls).toContainEqual({ type: "update.eq", table: "dashboard_email_otps", column: "attempt_count", value: "2" });
    expect(calls).toContainEqual({ type: "update.is", table: "dashboard_email_otps", column: "used_at", value: "null" });
    expect(calls).toContainEqual({ type: "update.select", table: "dashboard_email_otps", columns: "id" });
  });

  it("returns named failure reasons for missing, used, expired, and max-attempt OTP rows", async () => {
    const { verifyDashboardEmailOtp } = await import("./otpStore");

    otpSelectResult = { data: null, error: null };
    await expect(verifyDashboardEmailOtp({ otpId: OTP_ID, rawOtp: RAW_OTP })).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });

    otpSelectResult = {
      data: {
        id: OTP_ID,
        user_id: USER_ID,
        otp_hash: "hash",
        expires_at: "2026-07-10T10:10:00.000Z",
        used_at: NOW.toISOString(),
        attempt_count: 0,
      },
      error: null,
    };
    await expect(verifyDashboardEmailOtp({ otpId: OTP_ID, rawOtp: RAW_OTP })).resolves.toEqual({
      ok: false,
      reason: "used",
    });

    otpSelectResult = {
      data: {
        id: OTP_ID,
        user_id: USER_ID,
        otp_hash: "hash",
        expires_at: "2026-07-10T09:59:59.999Z",
        used_at: null,
        attempt_count: 0,
      },
      error: null,
    };
    await expect(verifyDashboardEmailOtp({ otpId: OTP_ID, rawOtp: RAW_OTP })).resolves.toEqual({
      ok: false,
      reason: "expired",
    });

    otpSelectResult = {
      data: {
        id: OTP_ID,
        user_id: USER_ID,
        otp_hash: "hash",
        expires_at: "2026-07-10T10:10:00.000Z",
        used_at: null,
        attempt_count: 5,
      },
      error: null,
    };
    await expect(verifyDashboardEmailOtp({ otpId: OTP_ID, rawOtp: RAW_OTP })).resolves.toEqual({
      ok: false,
      reason: "too_many_attempts",
    });
  });

  it("returns query_error on select or update errors", async () => {
    otpSelectResult = { data: null, error: { message: "select failed" } };
    const { verifyDashboardEmailOtp } = await import("./otpStore");

    await expect(verifyDashboardEmailOtp({ otpId: OTP_ID, rawOtp: RAW_OTP })).resolves.toEqual({
      ok: false,
      reason: "query_error",
    });

    const { hashOtp } = await import("./otp");
    otpSelectResult = {
      data: {
        id: OTP_ID,
        user_id: USER_ID,
        otp_hash: hashOtp(RAW_OTP),
        expires_at: "2026-07-10T10:10:00.000Z",
        used_at: null,
        attempt_count: 0,
      },
      error: null,
    };
    updateResult = { error: { message: "update failed" } };
    await expect(verifyDashboardEmailOtp({ otpId: OTP_ID, rawOtp: RAW_OTP })).resolves.toEqual({
      ok: false,
      reason: "query_error",
    });
  });
});
