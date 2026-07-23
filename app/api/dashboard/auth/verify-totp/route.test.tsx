import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyDashboardLoginTotp = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboardAuth/authFlow", () => ({
  verifyDashboardLoginTotp,
}));

function makeRequest(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://email-apply-wizz.test/api/dashboard/auth/verify-totp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

const previousNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.NODE_ENV = "test";
  verifyDashboardLoginTotp.mockReset();
  verifyDashboardLoginTotp.mockResolvedValue({ ok: true, sessionToken: "session-token-123" });
});

afterEach(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  vi.restoreAllMocks();
});

describe("POST /api/dashboard/auth/verify-totp", () => {
  it("sets the session cookie and returns only ok true", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        JSON.stringify({ challenge: "  challenge-1  ", code: " 123456 " }),
        {
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
    expect(verifyDashboardLoginTotp).toHaveBeenCalledWith({
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
      ),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("Secure");
  });

  it("does not set a cookie when the helper fails", async () => {
    verifyDashboardLoginTotp.mockResolvedValueOnce({ ok: false });
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        JSON.stringify({ challenge: "challenge-1", code: "123456" }),
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
      makeRequest(JSON.stringify(payload)),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
    expect(verifyDashboardLoginTotp).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest("{"),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("rejects oversized request bodies before parsing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(JSON.stringify({ challenge: "challenge-1", code: "123456" }), {
        "content-length": "8193",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
    expect(verifyDashboardLoginTotp).not.toHaveBeenCalled();
  });

  it("returns 400 on unexpected exceptions", async () => {
    verifyDashboardLoginTotp.mockRejectedValueOnce(new Error("boom"));
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(JSON.stringify({ challenge: "challenge-1", code: "123456" })),
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
      makeRequest(JSON.stringify({ challenge: "challenge-1", code: "123456" })),
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
