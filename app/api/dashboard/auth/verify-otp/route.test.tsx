import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyDashboardLoginOtp = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboardAuth/authFlow", () => ({
  verifyDashboardLoginOtp,
}));

function makeRequest(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://email-apply-wizz.test/api/dashboard/auth/verify-otp", {
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
  verifyDashboardLoginOtp.mockReset();
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.DASHBOARD_SECRET;
  else process.env.DASHBOARD_SECRET = previousSecret;
  vi.restoreAllMocks();
});

describe("POST /api/dashboard/auth/verify-otp", () => {
  it("returns the setup challenge payload without userId", async () => {
    verifyDashboardLoginOtp.mockResolvedValueOnce({
      ok: true,
      stage: "totp_setup_required",
      userId: "user-1",
      totpSecret: "secret",
      provisioningUri: "otpauth://totp/...",
      challenge: "challenge-1",
    });
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        JSON.stringify({ otpId: "  otp-123  ", rawOtp: " 123456 " }),
        {
          "x-forwarded-for": "203.0.113.10",
          "user-agent": "ApplyWizz Browser",
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      stage: "totp_setup_required",
      challenge: "challenge-1",
      totpSecret: "secret",
      provisioningUri: "otpauth://totp/...",
    });
    expect(verifyDashboardLoginOtp).toHaveBeenCalledWith({
      otpId: "otp-123",
      rawOtp: "123456",
      ip: "203.0.113.10",
      userAgent: "ApplyWizz Browser",
    });
  });

  it("returns the login challenge payload without userId", async () => {
    verifyDashboardLoginOtp.mockResolvedValueOnce({
      ok: true,
      stage: "totp_required",
      userId: "user-1",
      challenge: "challenge-2",
    });
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        JSON.stringify({ otpId: "otp-123", rawOtp: "123456" }),
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      stage: "totp_required",
      challenge: "challenge-2",
    });
  });

  it("returns 400 for authFlow failure", async () => {
    verifyDashboardLoginOtp.mockResolvedValueOnce({ ok: false });
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(
        JSON.stringify({ otpId: "otp-123", rawOtp: "123456" }),
      ),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
  });

  it.each([
    ["missing otpId", { rawOtp: "123456" }],
    ["missing rawOtp", { otpId: "otp-123" }],
    ["non-string otpId", { otpId: 123, rawOtp: "123456" }],
    ["non-string rawOtp", { otpId: "otp-123", rawOtp: 123 }],
    ["empty otpId", { otpId: "   ", rawOtp: "123456" }],
    ["empty rawOtp", { otpId: "otp-123", rawOtp: "   " }],
    ["oversized otpId", { otpId: "x".repeat(129), rawOtp: "123456" }],
    ["oversized rawOtp", { otpId: "otp-123", rawOtp: "x".repeat(33) }],
  ])("rejects %s", async (_label, payload) => {
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(JSON.stringify(payload)),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
    expect(verifyDashboardLoginOtp).not.toHaveBeenCalled();
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
      makeRequest(JSON.stringify({ otpId: "otp-123", rawOtp: "123456" }), {
        "content-length": "8193",
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
    expect(verifyDashboardLoginOtp).not.toHaveBeenCalled();
  });

  it("returns 400 on unexpected exceptions", async () => {
    verifyDashboardLoginOtp.mockRejectedValueOnce(new Error("boom"));
    const { POST } = await import("./route");
    const res = await POST(
      makeRequest(JSON.stringify({ otpId: "otp-123", rawOtp: "123456" })),
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
      makeRequest(JSON.stringify({ otpId: "otp-123", rawOtp: "123456" })),
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
