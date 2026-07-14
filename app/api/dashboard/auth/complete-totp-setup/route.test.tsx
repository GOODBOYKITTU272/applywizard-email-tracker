import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeDashboardTotpSetup = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboardAuth/authFlow", () => ({
  completeDashboardTotpSetup,
}));

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function makeRequest(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://email-apply-wizz.test/api/dashboard/auth/complete-totp-setup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

const previousSecret = process.env.DASHBOARD_SECRET;
const previousNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.DASHBOARD_SECRET = "test-dashboard-secret";
  process.env.NODE_ENV = "test";
  completeDashboardTotpSetup.mockReset();
  completeDashboardTotpSetup.mockResolvedValue({ ok: true, sessionToken: "session-token-123" });
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.DASHBOARD_SECRET;
  else process.env.DASHBOARD_SECRET = previousSecret;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  vi.restoreAllMocks();
});

describe("POST /api/dashboard/auth/complete-totp-setup", () => {
  it("returns 401 before authFlow when Basic Auth is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest(JSON.stringify({ challenge: "challenge", code: "123456" })));

    expect(res.status).toBe(401);
    expect(completeDashboardTotpSetup).not.toHaveBeenCalled();
  });

  it("sets the session cookie and returns only ok true", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        JSON.stringify({ challenge: "  challenge-1  ", code: " 123456 " }),
        {
          authorization: basicAuth("admin", "test-dashboard-secret"),
          "x-forwarded-for": "203.0.113.10",
          "user-agent": "ApplyWizz Browser",
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("set-cookie") ?? "").toContain("dashboard_session=session-token-123");
    expect(res.headers.get("set-cookie") ?? "").toContain("HttpOnly");
    expect(res.headers.get("set-cookie") ?? "").not.toContain("Secure");
    expect(res.headers.get("set-cookie") ?? "").toContain("SameSite=lax");
    expect(res.headers.get("set-cookie") ?? "").toContain("Path=/");
    expect(res.headers.get("set-cookie") ?? "").toContain("Max-Age=43200");
    expect(res.headers.get("set-cookie") ?? "").not.toContain("Domain=");
    expect(completeDashboardTotpSetup).toHaveBeenCalledWith({
      challenge: "challenge-1",
      code: "123456",
      ip: "203.0.113.10",
      userAgent: "ApplyWizz Browser",
    });
  });

  it("marks the cookie Secure in production", async () => {
    process.env.NODE_ENV = "production";
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        JSON.stringify({ challenge: "challenge-1", code: "123456" }),
        { authorization: basicAuth("admin", "test-dashboard-secret") },
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("Secure");
  });

  it("does not set a cookie when the helper fails", async () => {
    completeDashboardTotpSetup.mockResolvedValueOnce({ ok: false });
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        JSON.stringify({ challenge: "challenge-1", code: "123456" }),
        { authorization: basicAuth("admin", "test-dashboard-secret") },
      ),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it.each([
    ["missing challenge", { code: "123456" }],
    ["missing code", { challenge: "challenge-1" }],
    ["non-string challenge", { challenge: 123, code: "123456" }],
    ["non-string code", { challenge: "challenge-1", code: 123 }],
    ["empty challenge", { challenge: "   ", code: "123456" }],
    ["empty code", { challenge: "challenge-1", code: "   " }],
    ["oversized challenge", { challenge: "x".repeat(2049), code: "123456" }],
    ["oversized code", { challenge: "challenge-1", code: "x".repeat(11) }],
  ])("rejects %s", async (_label, payload) => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(JSON.stringify(payload), {
        authorization: basicAuth("admin", "test-dashboard-secret"),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
    expect(completeDashboardTotpSetup).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest("{", { authorization: basicAuth("admin", "test-dashboard-secret") }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("rejects oversized request bodies before parsing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(JSON.stringify({ challenge: "challenge-1", code: "123456" }), {
        authorization: basicAuth("admin", "test-dashboard-secret"),
        "content-length": "8193",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
    expect(completeDashboardTotpSetup).not.toHaveBeenCalled();
  });

  it("returns 400 on unexpected exceptions", async () => {
    completeDashboardTotpSetup.mockRejectedValueOnce(new Error("boom"));
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(JSON.stringify({ challenge: "challenge-1", code: "123456" }), {
        authorization: basicAuth("admin", "test-dashboard-secret"),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("does not log sensitive values", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { POST } = await import("./route");

    await POST(
      makeRequest(JSON.stringify({ challenge: "challenge-1", code: "123456" }), {
        authorization: basicAuth("admin", "test-dashboard-secret"),
      }),
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
