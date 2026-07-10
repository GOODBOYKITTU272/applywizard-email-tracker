import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type AuditRow = {
  id: string;
  user_id: string;
  event_type: string;
  success: boolean;
  created_at: string;
};

type QueryState = "ok" | "error" | "throw";

let auditRows: AuditRow[];
let queryState: QueryState;

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => {
      expect(table).toBe("dashboard_auth_audit_events");
      return {
        select: (columns: string) => {
          expect(columns).toBe("id");
          const filters: Record<string, string | boolean> = {};
          const chain = {
            eq: (column: string, value: string | boolean) => {
              filters[column] = value;
              return chain;
            },
            gte: (column: string, value: string) => {
              filters[column] = value;
              return chain;
            },
            then: (onfulfilled?: (value: { data: AuditRow[] | null; error: { message: string } | null }) => unknown) => {
              if (queryState === "throw") throw new Error("audit query threw");
              if (queryState === "error") {
                return Promise.resolve(onfulfilled?.({ data: null, error: { message: "audit query failed" } }));
              }

              const rows = auditRows.filter((row) => {
                if (filters.user_id && row.user_id !== filters.user_id) return false;
                if (filters.event_type && row.event_type !== filters.event_type) return false;
                if (filters.success !== undefined && row.success !== filters.success) return false;
                if (filters.created_at && row.created_at < String(filters.created_at)) return false;
                return true;
              });

              return Promise.resolve(onfulfilled?.({ data: rows, error: null }));
            },
          };
          return chain;
        },
      };
    },
  }),
}));

const NOW = new Date("2026-07-11T10:00:00.000Z");

function recent(minutesAgo: number): string {
  return new Date(NOW.getTime() - minutesAgo * 60 * 1000).toISOString();
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  auditRows = [];
  queryState = "ok";
});

describe("dashboard auth rate limiting", () => {
  it("counts recent login OTP request sends and fails closed on query errors", async () => {
    const { isDashboardLoginOtpRequestThrottled } = await import("./rateLimit");

    auditRows = [
      { id: "1", user_id: "u1", event_type: "login_otp_requested", success: true, created_at: recent(1) },
      { id: "2", user_id: "u1", event_type: "login_otp_requested", success: true, created_at: recent(2) },
    ];
    await expect(isDashboardLoginOtpRequestThrottled("u1")).resolves.toBe(false);

    auditRows = [
      { id: "1", user_id: "u1", event_type: "login_otp_requested", success: true, created_at: recent(1) },
      { id: "2", user_id: "u1", event_type: "login_otp_requested", success: true, created_at: recent(2) },
      { id: "3", user_id: "u1", event_type: "login_otp_requested", success: true, created_at: recent(3) },
    ];
    await expect(isDashboardLoginOtpRequestThrottled("u1")).resolves.toBe(true);

    auditRows = [
      { id: "1", user_id: "u1", event_type: "login_otp_requested", success: true, created_at: recent(20) },
      { id: "2", user_id: "u1", event_type: "login_otp_requested", success: true, created_at: recent(1) },
      { id: "3", user_id: "u1", event_type: "login_otp_requested", success: true, created_at: recent(2) },
      { id: "4", user_id: "u1", event_type: "login_otp_requested", success: true, created_at: recent(3) },
    ];
    await expect(isDashboardLoginOtpRequestThrottled("u1")).resolves.toBe(true);

    queryState = "error";
    await expect(isDashboardLoginOtpRequestThrottled("u1")).resolves.toBe(true);
    queryState = "throw";
    await expect(isDashboardLoginOtpRequestThrottled("u1")).resolves.toBe(true);
  });

  it("counts recent TOTP setup failures and fails closed on query errors", async () => {
    const { isDashboardTotpSetupThrottled } = await import("./rateLimit");

    auditRows = [
      { id: "1", user_id: "u1", event_type: "totp_setup_completed", success: false, created_at: recent(1) },
      { id: "2", user_id: "u1", event_type: "totp_setup_completed", success: false, created_at: recent(2) },
      { id: "3", user_id: "u1", event_type: "totp_setup_completed", success: false, created_at: recent(3) },
      { id: "4", user_id: "u1", event_type: "totp_setup_completed", success: false, created_at: recent(4) },
    ];
    await expect(isDashboardTotpSetupThrottled("u1")).resolves.toBe(false);

    auditRows.push({ id: "5", user_id: "u1", event_type: "totp_setup_completed", success: false, created_at: recent(5) });
    await expect(isDashboardTotpSetupThrottled("u1")).resolves.toBe(true);

    auditRows = [
      { id: "1", user_id: "u1", event_type: "totp_setup_completed", success: false, created_at: recent(20) },
      { id: "2", user_id: "u1", event_type: "totp_setup_completed", success: false, created_at: recent(1) },
      { id: "3", user_id: "u1", event_type: "totp_setup_completed", success: false, created_at: recent(2) },
      { id: "4", user_id: "u1", event_type: "totp_setup_completed", success: false, created_at: recent(3) },
      { id: "5", user_id: "u1", event_type: "totp_setup_completed", success: false, created_at: recent(4) },
    ];
    await expect(isDashboardTotpSetupThrottled("u1")).resolves.toBe(false);

    queryState = "error";
    await expect(isDashboardTotpSetupThrottled("u1")).resolves.toBe(true);
    queryState = "throw";
    await expect(isDashboardTotpSetupThrottled("u1")).resolves.toBe(true);
  });

  it("counts recent TOTP login failures and fails closed on query errors", async () => {
    const { isDashboardTotpLoginThrottled } = await import("./rateLimit");

    auditRows = [
      { id: "1", user_id: "u1", event_type: "login_totp_verify", success: false, created_at: recent(1) },
      { id: "2", user_id: "u1", event_type: "login_totp_verify", success: false, created_at: recent(2) },
      { id: "3", user_id: "u1", event_type: "login_totp_verify", success: false, created_at: recent(3) },
      { id: "4", user_id: "u1", event_type: "login_totp_verify", success: false, created_at: recent(4) },
    ];
    await expect(isDashboardTotpLoginThrottled("u1")).resolves.toBe(false);

    auditRows.push({ id: "5", user_id: "u1", event_type: "login_totp_verify", success: false, created_at: recent(5) });
    await expect(isDashboardTotpLoginThrottled("u1")).resolves.toBe(true);

    auditRows = [
      { id: "1", user_id: "u1", event_type: "login_totp_verify", success: false, created_at: recent(20) },
      { id: "2", user_id: "u1", event_type: "login_totp_verify", success: false, created_at: recent(1) },
      { id: "3", user_id: "u1", event_type: "login_totp_verify", success: false, created_at: recent(2) },
      { id: "4", user_id: "u1", event_type: "login_totp_verify", success: false, created_at: recent(3) },
      { id: "5", user_id: "u1", event_type: "login_totp_verify", success: false, created_at: recent(4) },
    ];
    await expect(isDashboardTotpLoginThrottled("u1")).resolves.toBe(false);

    queryState = "error";
    await expect(isDashboardTotpLoginThrottled("u1")).resolves.toBe(true);
    queryState = "throw";
    await expect(isDashboardTotpLoginThrottled("u1")).resolves.toBe(true);
  });
});
