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

const validSession = {
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
};

describe("requireDashboardSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    });
    getDashboardSessionByTokenMock.mockResolvedValue({ ok: false });
  });

  it("redirects to /dashboard/login when the dashboard session cookie is missing", async () => {
    const { requireDashboardSession } = await import("./requireDashboardSession");

    await expect(requireDashboardSession()).rejects.toThrow("REDIRECT:/dashboard/login");
    expect(getDashboardSessionByTokenMock).not.toHaveBeenCalled();
  });

  it.each([
    "fake token",
    "malformed token",
    "expired session",
    "revoked session",
    "disabled user",
    "missing user",
    "database failure",
  ])("redirects to /dashboard/login for %s", async () => {
    cookiesMock.mockResolvedValueOnce({
      get: vi.fn().mockReturnValue({ value: "raw-session-token" }),
    });
    getDashboardSessionByTokenMock.mockResolvedValueOnce({ ok: false });
    const { requireDashboardSession } = await import("./requireDashboardSession");

    await expect(requireDashboardSession()).rejects.toThrow("REDIRECT:/dashboard/login");
    expect(getDashboardSessionByTokenMock).toHaveBeenCalledWith("raw-session-token");
  });

  it("redirects to /dashboard/login when session validation throws unexpectedly", async () => {
    cookiesMock.mockResolvedValueOnce({
      get: vi.fn().mockReturnValue({ value: "raw-session-token" }),
    });
    getDashboardSessionByTokenMock.mockRejectedValueOnce(new Error("db unavailable"));
    const { requireDashboardSession } = await import("./requireDashboardSession");

    await expect(requireDashboardSession()).rejects.toThrow("REDIRECT:/dashboard/login");
  });

  it("returns the validated session when the reviewed helper succeeds", async () => {
    cookiesMock.mockResolvedValueOnce({
      get: vi.fn().mockReturnValue({ value: "raw-session-token" }),
    });
    getDashboardSessionByTokenMock.mockResolvedValueOnce({ ok: true, session: validSession });
    const { requireDashboardSession } = await import("./requireDashboardSession");

    await expect(requireDashboardSession()).resolves.toEqual(validSession);
    expect(getDashboardSessionByTokenMock).toHaveBeenCalledWith("raw-session-token");
  });

  it("does not log raw session tokens on success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    cookiesMock.mockResolvedValueOnce({
      get: vi.fn().mockReturnValue({ value: "raw-session-token" }),
    });
    getDashboardSessionByTokenMock.mockResolvedValueOnce({ ok: false });
    const { requireDashboardSession } = await import("./requireDashboardSession");

    await expect(requireDashboardSession()).rejects.toThrow("REDIRECT:/dashboard/login");
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
