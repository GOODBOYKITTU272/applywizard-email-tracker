import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revokeDashboardSession = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboardAuth/sessionStore", () => ({
  revokeDashboardSession,
}));

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://email-apply-wizz.test/api/dashboard/auth/logout", {
    method: "POST",
    headers,
  });
}

const previousSecret = process.env.DASHBOARD_SECRET;
const previousNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.DASHBOARD_SECRET = "test-dashboard-secret";
  process.env.NODE_ENV = "test";
  revokeDashboardSession.mockReset();
  revokeDashboardSession.mockResolvedValue({ ok: true });
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.DASHBOARD_SECRET;
  else process.env.DASHBOARD_SECRET = previousSecret;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  vi.restoreAllMocks();
});

describe("POST /api/dashboard/auth/logout", () => {
  it("revokes a valid session cookie and clears the cookie", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        cookie: "dashboard_session=raw-session-token",
        origin: "https://email-apply-wizz.test",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(revokeDashboardSession).toHaveBeenCalledWith("raw-session-token");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("dashboard_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).not.toContain("Secure");
    expect(setCookie).not.toContain("Domain=");
  });

  it("marks the cleared cookie Secure in production", async () => {
    process.env.NODE_ENV = "production";
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        cookie: "dashboard_session=raw-session-token",
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("Secure");
  });

  it.each([
    ["no cookie", ""],
    ["malformed cookie", "dashboard_session=%"],
    ["expired cookie value", "dashboard_session=expired-session"],
    ["already revoked cookie value", "dashboard_session=already-revoked"],
  ])("returns success and clears the cookie for %s", async (_label, cookie) => {
    const { POST } = await import("./route");
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;

    const res = await POST(makeRequest(headers));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });

  it("returns success for repeated logout requests", async () => {
    const { POST } = await import("./route");
    const headers = {
      cookie: "dashboard_session=raw-session-token",
    };

    const first = await POST(makeRequest(headers));
    const second = await POST(makeRequest(headers));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(await second.json()).toEqual({ ok: true });
  });

  it("does not leak the revocation result", async () => {
    revokeDashboardSession.mockResolvedValueOnce({ ok: false });
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        cookie: "dashboard_session=raw-session-token",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("still clears the cookie when revocation throws unexpectedly", async () => {
    revokeDashboardSession.mockRejectedValueOnce(new Error("db unavailable"));
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        cookie: "dashboard_session=raw-session-token",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
  });

  it("accepts missing Origin and matching Origin", async () => {
    const { POST } = await import("./route");

    const missingOrigin = await POST(
      makeRequest(),
    );
    const matchingOrigin = await POST(
      makeRequest({
        origin: "https://email-apply-wizz.test",
      }),
    );

    expect(missingOrigin.status).toBe(200);
    expect(matchingOrigin.status).toBe(200);
  });

  it("rejects mismatched Origin with a generic failure", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest({
        cookie: "dashboard_session=raw-session-token",
        origin: "https://attacker.test",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
    expect(revokeDashboardSession).not.toHaveBeenCalled();
  });

  it("does not require a request body and does not log tokens", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { POST } = await import("./route");

    await POST(
      makeRequest({
        cookie: "dashboard_session=raw-session-token",
      }),
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
