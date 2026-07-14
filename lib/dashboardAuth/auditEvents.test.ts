import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let insertedRow: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => {
      expect(table).toBe("dashboard_auth_audit_events");
      return {
        insert: async (row: Record<string, unknown>) => {
          insertedRow = row;
          return { error: null };
        },
      };
    },
  }),
}));

describe("dashboard auth audit events", () => {
  beforeEach(() => {
    insertedRow = null;
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "audit-secret");
  });

  it("inserts audit events with hashed IP and user-agent values", async () => {
    const { hashSensitiveValue, recordDashboardAuthAuditEvent } = await import("./auditEvents");

    await recordDashboardAuthAuditEvent({
      userId: "user-1",
      email: "  ADMIN@ApplyWizz.AI ",
      eventType: "otp_verify",
      success: false,
      ip: "203.0.113.10",
      userAgent: "Raw Browser UA",
    });

    expect(insertedRow).toMatchObject({
      user_id: "user-1",
      email: "admin@applywizz.ai",
      event_type: "otp_verify",
      success: false,
      ip_hash: hashSensitiveValue("203.0.113.10"),
      user_agent_hash: hashSensitiveValue("Raw Browser UA"),
    });
    expect(JSON.stringify(insertedRow)).not.toContain("203.0.113.10");
    expect(JSON.stringify(insertedRow)).not.toContain("Raw Browser UA");
  });

  it("does not throw when the audit insert fails", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/serviceRole", () => ({
      createSupabaseServiceRoleClient: () => ({
        from: () => ({
          insert: async () => ({ error: { message: "insert failed" } }),
        }),
      }),
    }));

    const { recordDashboardAuthAuditEvent } = await import("./auditEvents");

    await expect(
      recordDashboardAuthAuditEvent({
        eventType: "login_failed",
        success: false,
        ip: "203.0.113.20",
        userAgent: "Another Raw UA",
      }),
    ).resolves.toBeUndefined();
  });
});
