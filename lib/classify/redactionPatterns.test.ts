import { describe, expect, it } from "vitest";
import { redactSensitivePatterns } from "./redactionPatterns";

describe("redactSensitivePatterns", () => {
  it("redacts a URL", () => {
    expect(redactSensitivePatterns("Visit https://example.com/reset now")).toBe(
      "Visit [redacted-url] now",
    );
  });

  it("redacts an email address", () => {
    expect(redactSensitivePatterns("Contact test@example.com for help")).toBe(
      "Contact [redacted-email] for help",
    );
  });

  it("redacts a 6-digit OTP-shaped code", () => {
    expect(redactSensitivePatterns("Your code is 482910 today")).toBe(
      "Your code is [redacted-code] today",
    );
  });

  it("redacts a long token", () => {
    expect(redactSensitivePatterns("token: abcdefghijklmnopqrstuvwxABCDEF123456")).toBe(
      "token: [redacted-token]",
    );
  });

  it("redacts a password marker", () => {
    expect(redactSensitivePatterns("Your password has been reset")).toBe(
      "Your [redacted-marker] has been reset",
    );
  });

  it("redacts a secret/api-key marker", () => {
    expect(redactSensitivePatterns("Your api key is required")).toBe(
      "Your [redacted-marker] is required",
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSensitivePatterns("Thanks for applying to the Data Analyst role")).toBe(
      "Thanks for applying to the Data Analyst role",
    );
  });
});
