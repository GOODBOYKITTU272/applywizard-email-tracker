import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("OTP hashing", () => {
  it("verifies the correct OTP and rejects the wrong OTP", async () => {
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "otp-secret");
    const { generateRawOtp, hashOtp, verifyOtp } = await import("./otp");

    const hash = hashOtp("123456");

    expect(hash).not.toBe("123456");
    expect(verifyOtp("123456", hash)).toBe(true);
    expect(verifyOtp("000000", hash)).toBe(false);
    expect(generateRawOtp()).toMatch(/^\d{6}$/u);
  });
});
