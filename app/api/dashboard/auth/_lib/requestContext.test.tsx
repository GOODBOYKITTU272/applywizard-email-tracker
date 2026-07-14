import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("https://email-apply-wizz.test/api/dashboard/auth/request-otp", {
    method: "POST",
    headers,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractRequestContext", () => {
  it("picks the first x-forwarded-for entry", async () => {
    const { extractRequestContext } = await import("./requestContext");
    const context = extractRequestContext(
      makeRequest({
        "x-forwarded-for": "203.0.113.10, 198.51.100.20",
        "user-agent": "ApplyWizz Browser",
      }),
    );

    expect(context).toEqual({ ip: "203.0.113.10", userAgent: "ApplyWizz Browser" });
  });

  it("falls back to x-real-ip", async () => {
    const { extractRequestContext } = await import("./requestContext");
    const context = extractRequestContext(
      makeRequest({
        "x-real-ip": "198.51.100.77",
      }),
    );

    expect(context).toEqual({ ip: "198.51.100.77", userAgent: undefined });
  });

  it("returns undefined values when headers are absent", async () => {
    const { extractRequestContext } = await import("./requestContext");
    const context = extractRequestContext(makeRequest({}));

    expect(context).toEqual({ ip: undefined, userAgent: undefined });
  });

  it("truncates IP and user agent values", async () => {
    const { extractRequestContext } = await import("./requestContext");
    const context = extractRequestContext(
      makeRequest({
        "x-forwarded-for": `${"1".repeat(300)}, 198.51.100.20`,
        "user-agent": "u".repeat(600),
      }),
    );

    expect(context.ip).toHaveLength(256);
    expect(context.userAgent).toHaveLength(512);
  });
});
