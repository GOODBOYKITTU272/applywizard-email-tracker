import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startDashboardLogin = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboardAuth/authFlow", () => ({
  startDashboardLogin,
}));

function makeRequest(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://email-apply-wizz.test/api/dashboard/auth/request-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

const previousSecret = process.env.DASHBOARD_SECRET;

beforeEach(() => {
  process.env.DASHBOARD_SECRET = "test-dashboard-secret";
  startDashboardLogin.mockReset();
  startDashboardLogin.mockResolvedValue({ ok: true, nextStep: "email_otp", challengeId: "otp-123" });
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.DASHBOARD_SECRET;
  else process.env.DASHBOARD_SECRET = previousSecret;
  vi.restoreAllMocks();
});

describe("POST /api/dashboard/auth/request-otp", () => {
  it("returns 200 and calls startDashboardLogin with trimmed email and request context", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        JSON.stringify({ email: "  user@applywizz.ai  " }),
        {
          "x-forwarded-for": "203.0.113.10, 198.51.100.20",
          "user-agent": "ApplyWizz Browser",
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, nextStep: "email_otp", challengeId: "otp-123" });
    expect(startDashboardLogin).toHaveBeenCalledWith({
      email: "user@applywizz.ai",
      ip: "203.0.113.10",
      userAgent: "ApplyWizz Browser",
    });
  });

  it("returns the totp response shape for a returning authenticator user", async () => {
    startDashboardLogin.mockResolvedValueOnce({ ok: true, nextStep: "totp", challenge: "loginchallengev1_token" });
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(JSON.stringify({ email: "user@applywizz.ai" })),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, nextStep: "totp", challenge: "loginchallengev1_token" });
  });

  it.each([
    ["unknown email", { ok: true, nextStep: "email_otp", challengeId: "otp-unknown" }],
    ["disabled user", { ok: true, nextStep: "email_otp", challengeId: "otp-disabled" }],
    ["throttled active user", { ok: true, nextStep: "email_otp", challengeId: "otp-throttled" }],
  ])("keeps the same generic response shape for %s", async (_label, response) => {
    startDashboardLogin.mockResolvedValueOnce(response);
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(JSON.stringify({ email: "user@applywizz.ai" })),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(response);
  });

  it("rejects malformed JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest("{"),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
  });

  it.each([
    ["missing email", {}],
    ["non-string email", { email: 123 }],
    ["empty email", { email: "   " }],
    ["oversized email", { email: `${"a".repeat(255)}@applywizz.ai` }],
  ])("rejects %s", async (_label, payload) => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(JSON.stringify(payload)),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
    expect(startDashboardLogin).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies before parsing", async () => {
    const { POST } = await import("./route");
    const req = makeRequest(JSON.stringify({ email: "user@applywizz.ai" }), {
      "content-length": "8193",
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
    expect(startDashboardLogin).not.toHaveBeenCalled();
  });

  it("returns 400 on unexpected exceptions", async () => {
    startDashboardLogin.mockRejectedValueOnce(new Error("boom"));
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(JSON.stringify({ email: "user@applywizz.ai" })),
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
      makeRequest(JSON.stringify({ email: "user@applywizz.ai" })),
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
