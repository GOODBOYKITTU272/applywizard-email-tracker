import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("session token hashing", () => {
  it("verifies the correct session token and rejects the wrong token", async () => {
    vi.stubEnv("DASHBOARD_SESSION_SECRET", "session-secret");
    const { generateRawSessionToken, hashSessionToken, verifySessionToken } = await import("./session");

    const hash = hashSessionToken("raw-session-token");
    const generatedToken = generateRawSessionToken();

    expect(hash).not.toBe("raw-session-token");
    expect(verifySessionToken("raw-session-token", hash)).toBe(true);
    expect(verifySessionToken("other-session-token", hash)).toBe(false);
    expect(generatedToken).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(generatedToken.length).toBeGreaterThan(40);
  });
});
