import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireDashboardSession = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/dashboardAuth/requireDashboardSession", () => ({ requireDashboardSession }));
vi.mock("next/navigation", () => ({ redirect }));

function session(role: "admin_ceo" | "manager_ops" | "ca") {
  return {
    id: "session-1",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 1000).toISOString(),
    revokedAt: null,
    user: { id: "user-1", email: "user@applywizz.ai", role, status: "active" as const, totpEnabled: true },
  };
}

describe("requireOperationsAccess", () => {
  it("returns the session for admin_ceo", async () => {
    requireDashboardSession.mockResolvedValue(session("admin_ceo"));
    const { requireOperationsAccess } = await import("./requireOperationsAccess");
    await expect(requireOperationsAccess()).resolves.toMatchObject({ user: { role: "admin_ceo" } });
  });

  it("returns the session for manager_ops", async () => {
    requireDashboardSession.mockResolvedValue(session("manager_ops"));
    const { requireOperationsAccess } = await import("./requireOperationsAccess");
    await expect(requireOperationsAccess()).resolves.toMatchObject({ user: { role: "manager_ops" } });
  });

  it("redirects ca to /access-pending without ever returning the session", async () => {
    requireDashboardSession.mockResolvedValue(session("ca"));
    const { requireOperationsAccess } = await import("./requireOperationsAccess");
    await expect(requireOperationsAccess()).rejects.toThrow("REDIRECT:/access-pending");
  });
});
