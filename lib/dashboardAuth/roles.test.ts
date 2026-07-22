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

describe("resolveAutoProvisionRole", () => {
  it("assigns admin_ceo to the designated admin address", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("ramakrishna@applywizz.ai")).toEqual({
      eligible: true,
      email: "ramakrishna@applywizz.ai",
      role: "admin_ceo",
    });
  });

  it("assigns manager_ops to both designated manager addresses", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("ramakrishnaa.tejavath@applywizz.ai")).toMatchObject({ eligible: true, role: "manager_ops" });
    expect(resolveAutoProvisionRole("balaji@applywizz.ai")).toMatchObject({ eligible: true, role: "manager_ops" });
  });

  it("assigns ca to any other valid applywizz address", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("user@applywizz.ai")).toEqual({
      eligible: true,
      email: "user@applywizz.ai",
      role: "ca",
    });
  });

  it("trims and lowercases before matching", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("  USER@APPLYWIZZ.AI  ")).toEqual({
      eligible: true,
      email: "user@applywizz.ai",
      role: "ca",
    });
  });

  it("rejects subdomains, lookalikes, product-mailbox domain, and external domains", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("user+test@applywizz.ai")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("user@sub.applywizz.ai")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("user@applywizz.ai.evil")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("user@applywizard.ai")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("user@gmail.com")).toEqual({ eligible: false });
  });

  it("rejects malformed input without throwing", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("@applywizz.ai")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("user@")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("not-an-email")).toEqual({ eligible: false });
  });
});
