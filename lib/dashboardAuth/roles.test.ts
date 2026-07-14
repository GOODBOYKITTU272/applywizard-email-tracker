import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("dashboard roles", () => {
  it("allows only admin_ceo to access broad dashboards in Phase 1", async () => {
    const { canAccessBroadDashboards, isAdminCeo } = await import("./roles");

    expect(isAdminCeo("admin_ceo")).toBe(true);
    expect(isAdminCeo("manager_ops")).toBe(false);
    expect(isAdminCeo("ca")).toBe(false);
    expect(canAccessBroadDashboards("admin_ceo")).toBe(true);
    expect(canAccessBroadDashboards("manager_ops")).toBe(false);
    expect(canAccessBroadDashboards("ca")).toBe(false);
  });
});
