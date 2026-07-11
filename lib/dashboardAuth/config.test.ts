import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("dashboard auth config", () => {
  it("reads the dashboard session secret from env", async () => {
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "test-secret");
    const { getDashboardAuthSecret } = await import("./config");

    expect(getDashboardAuthSecret()).toBe("test-secret");
  });

  it("uses a test fallback when the secret is missing in tests", async () => {
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "");
    const { getDashboardAuthSecret } = await import("./config");

    expect(getDashboardAuthSecret()).toBe("dashboard-auth-test-secret");
  });

  it("reads the dashboard TOTP encryption key from env", async () => {
    vi.stubEnv("DASHBOARD_TOTP_ENCRYPTION_KEY", "totp-key");
    const { getDashboardTotpEncryptionKey } = await import("./config");

    expect(getDashboardTotpEncryptionKey()).toBe("totp-key");
  });

  it("uses a test fallback for the dashboard TOTP encryption key when missing in tests", async () => {
    vi.stubEnv("DASHBOARD_TOTP_ENCRYPTION_KEY", "");
    const { getDashboardTotpEncryptionKey } = await import("./config");

    expect(getDashboardTotpEncryptionKey()).toBe("dashboard-totp-test-secret");
  });

  it("reads the dashboard login challenge secret from env", async () => {
    vi.stubEnv("DASHBOARD_LOGIN_CHALLENGE_SECRET", "challenge-secret");
    const { getDashboardLoginChallengeSecret } = await import("./config");

    expect(getDashboardLoginChallengeSecret()).toBe("challenge-secret");
  });

  it("uses a test fallback for the dashboard login challenge secret when missing in tests", async () => {
    vi.stubEnv("DASHBOARD_LOGIN_CHALLENGE_SECRET", "");
    const { getDashboardLoginChallengeSecret } = await import("./config");

    expect(getDashboardLoginChallengeSecret()).toBe("dashboard-login-challenge-test-secret");
  });

  it("throws without logging when the dashboard login challenge secret is missing outside tests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DASHBOARD_LOGIN_CHALLENGE_SECRET", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getDashboardLoginChallengeSecret } = await import("./config");

    expect(() => getDashboardLoginChallengeSecret()).toThrow("Dashboard login challenge secret is not configured.");
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
