import { describe, expect, it } from "vitest";

import {
  MAX_INPUT_REASON_LENGTH,
  SAFE_REASON_FALLBACK,
  reasonMatchesUnsafePolicy,
  sanitizeReason,
} from "./sanitizeReason";

describe("sanitizeReason", () => {
  it("redacts URLs", () => {
    expect(sanitizeReason("Please visit https://example.com/reset now.")).toBe(
      "Please visit [redacted-url] now.",
    );
  });

  it("redacts email addresses", () => {
    expect(sanitizeReason("Matched recruiter@company.com in classifier output.")).toBe(
      "Matched [redacted-email] in classifier output.",
    );
  });

  it("redacts OTP-like numeric codes", () => {
    expect(sanitizeReason("Detected verification code 482910 in content.")).toBe(
      "Detected verification code [redacted-code] in content.",
    );
  });

  it("redacts token-like strings", () => {
    expect(sanitizeReason("Token test_payment_key_should_be_redacted was present.")).toBe(
      "Token [redacted-token] was present.",
    );
  });

  it("removes quoted excerpts", () => {
    expect(sanitizeReason('Provider said "please click this private reset link immediately".')).toBe(
      "Provider said [redacted-quote].",
    );
  });

  it("redacts password-like markers", () => {
    expect(sanitizeReason("Matched password reset flow in deterministic fallback.")).toBe(
      "Matched [redacted-marker] reset flow in deterministic fallback.",
    );
  });

  it("redacts secret-style keywords", () => {
    expect(sanitizeReason("Contains access token marker from provider metadata.")).toBe(
      "Contains [redacted-marker] marker from provider metadata.",
    );
  });

  it("caps reason length to a short maximum", () => {
    const safe = sanitizeReason("Long safe reason ".repeat(8));
    expect(safe.length).toBeLessThanOrEqual(96);
    expect(safe.endsWith("…")).toBe(true);
  });

  it("falls back to a generic safe reason for long suspicious text", () => {
    expect(sanitizeReason("A".repeat(MAX_INPUT_REASON_LENGTH + 1))).toBe(
      SAFE_REASON_FALLBACK,
    );
  });

  it("falls back to a generic safe reason for raw provider output", () => {
    expect(sanitizeReason('{"reason":"raw provider output"}')).toBe(
      SAFE_REASON_FALLBACK,
    );
  });

  it("applies the shared unsafe policy to migration-style detections", () => {
    expect(reasonMatchesUnsafePolicy("Contains provider output with access token marker.")).toBe(
      true,
    );
    expect(reasonMatchesUnsafePolicy("Short generic classifier summary.")).toBe(false);
  });
});
