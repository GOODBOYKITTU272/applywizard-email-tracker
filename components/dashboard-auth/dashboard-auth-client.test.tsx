import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe("DashboardAuthClient landing layout", () => {
  it("shows only the email step's heading, not a visible step-tabs strip", async () => {
    const { DashboardAuthClient } = await import("./dashboard-auth-client");
    const markup = renderToStaticMarkup(<DashboardAuthClient />);

    expect(markup).toContain('data-testid="dashboard-auth-email"');
    expect(markup).not.toContain("Authentication steps");
    expect(markup).not.toContain("dashboard-auth-steps");
  });

  it("does not show the setup progress indicator on the email step", async () => {
    const { DashboardAuthClient } = await import("./dashboard-auth-client");
    const markup = renderToStaticMarkup(<DashboardAuthClient />);

    expect(markup).not.toContain('aria-label="Setup progress"');
  });
});
