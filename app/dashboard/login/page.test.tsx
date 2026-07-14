import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();
const getDashboardSessionByTokenMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));
vi.mock("@/lib/dashboardAuth/sessionStore", () => ({
  getDashboardSessionByToken: getDashboardSessionByTokenMock,
}));
vi.mock("@/components/dashboard-auth/dashboard-auth-client", () => ({
  DashboardAuthClient: () => <div data-testid="dashboard-auth-shell">Login UI</div>,
}));

describe("DashboardLoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    });
    getDashboardSessionByTokenMock.mockResolvedValue({ ok: false });
  });

  it("renders the login flow when no dashboard session cookie exists", async () => {
    const { default: DashboardLoginPage } = await import("./page");

    const markup = renderToStaticMarkup(await DashboardLoginPage());

    expect(getDashboardSessionByTokenMock).not.toHaveBeenCalled();
    expect(markup).toContain("Login UI");
  });

  it("renders the login flow when the session lookup fails closed", async () => {
    cookiesMock.mockResolvedValueOnce({
      get: vi.fn().mockReturnValue({ value: "existing-session" }),
    });
    getDashboardSessionByTokenMock.mockResolvedValueOnce({ ok: false });
    const { default: DashboardLoginPage } = await import("./page");

    const markup = renderToStaticMarkup(await DashboardLoginPage());

    expect(getDashboardSessionByTokenMock).toHaveBeenCalledWith("existing-session");
    expect(markup).toContain("Login UI");
  });

  it.each([
    "expired session",
    "revoked session",
    "disabled-user session",
    "malformed session",
    "missing user session",
    "database failure",
  ])("renders the login flow for %s", async () => {
    cookiesMock.mockResolvedValueOnce({
      get: vi.fn().mockReturnValue({ value: "existing-session" }),
    });
    getDashboardSessionByTokenMock.mockResolvedValueOnce({ ok: false });
    const { default: DashboardLoginPage } = await import("./page");

    const markup = renderToStaticMarkup(await DashboardLoginPage());

    expect(markup).toContain("Login UI");
  });

  it("redirects to /overview when the reviewed session helper returns a valid session", async () => {
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "valid-session-token" }),
    });
    getDashboardSessionByTokenMock.mockResolvedValue({
      ok: true,
      session: {
        id: "session-1",
        userId: "user-1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        revokedAt: null,
        user: {
          id: "user-1",
          email: "admin@applywizz.ai",
          role: "admin_ceo",
          status: "active",
          totpEnabled: true,
        },
      },
    });
    const { default: DashboardLoginPage } = await import("./page");

    await expect(DashboardLoginPage()).rejects.toThrow("REDIRECT:/overview");
    expect(getDashboardSessionByTokenMock).toHaveBeenCalledWith("valid-session-token");
  });
});
