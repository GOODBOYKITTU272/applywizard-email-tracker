import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// This repo has no @testing-library/react / jsdom (vitest.config.ts uses
// environment: "node"), so this suite renders with renderToStaticMarkup and
// asserts on the resulting HTML string, matching the established pattern in
// components/dashboard-auth/authenticator-setup.test.tsx.
vi.mock("next/navigation", () => ({ usePathname: () => "/overview" }));

// next/font/google's exports are only made callable by Next's build pipeline
// (webpack/SWC font loader); under vitest they are not functions and calling
// them throws (see the identical note in
// components/dashboard-auth/dashboard-auth-client.tsx). Mocking the module
// lets this suite import the unmodified client component without crashing.
vi.mock("next/font/google", () => {
  const loader = () => ({
    variable: "font-mock",
    style: { fontFamily: "sans-serif" },
  });
  return { Noto_Sans: loader, Inter: loader, Space_Grotesk: loader };
});

describe("OperationsShellClient", () => {
  it("renders the real signed-in employee name and role label", async () => {
    const { OperationsShellClient } = await import("./operations-shell-client");
    const markup = renderToStaticMarkup(
      <OperationsShellClient userName="Ramakrishna Chanda" userRole="admin_ceo">
        <div>content</div>
      </OperationsShellClient>,
    );

    expect(markup).toContain("Ramakrishna Chanda");
    expect(markup).toContain(">Admin<");
  });

  it("labels a manager_ops session as Manager and a ca session as CA", async () => {
    const { OperationsShellClient } = await import("./operations-shell-client");

    const managerMarkup = renderToStaticMarkup(
      <OperationsShellClient userName="Balaji" userRole="manager_ops">
        <div>content</div>
      </OperationsShellClient>,
    );
    expect(managerMarkup).toContain("Balaji");
    expect(managerMarkup).toContain(">Manager<");

    const caMarkup = renderToStaticMarkup(
      <OperationsShellClient userName="Navya" userRole="ca">
        <div>content</div>
      </OperationsShellClient>,
    );
    expect(caMarkup).toContain("Navya");
    expect(caMarkup).toContain(">CA<");
  });

  it("still renders the sign-out controls and nav links unchanged", async () => {
    const { OperationsShellClient } = await import("./operations-shell-client");
    const markup = renderToStaticMarkup(
      <OperationsShellClient userName="Ramakrishna Chanda" userRole="admin_ceo">
        <div>content</div>
      </OperationsShellClient>,
    );

    // The mobile drawer (and its own logout button) only renders once
    // mobileMenuOpen becomes true via useState, so it is absent from the
    // initial static markup; the desktop sidebar and bottom-nav logout
    // controls render unconditionally and are checked here instead.
    expect(markup).toContain('data-testid="dashboard-logout-button"');
    expect(markup).toContain('data-testid="dashboard-bottom-logout-button"');
    expect(markup).toContain("Overview");
    expect(markup).toContain("Live Monitor");
    expect(markup).toContain("Review Queue");
  });
});
