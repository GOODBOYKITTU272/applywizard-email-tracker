import { createCipheriv, createHash } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const FAKE_CHALLENGE_SECRET = "challenge-secret";
const OTHER_CHALLENGE_SECRET = "other-challenge-secret";
const USER_ID = "user-1";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function sealPayload(secret: string, payload: unknown): string {
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `loginchallengev1_${Buffer.concat([iv, authTag, ciphertext]).toString("base64url")}`;
}

beforeEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubEnv("DASHBOARD_LOGIN_CHALLENGE_SECRET", FAKE_CHALLENGE_SECRET);
});

describe("login challenge", () => {
  it("round-trips a totp_setup challenge", async () => {
    const { issueDashboardLoginChallenge, verifyDashboardLoginChallenge } = await import("./loginChallenge");

    const token = issueDashboardLoginChallenge({
      userId: USER_ID,
      stage: "totp_setup",
      totpSecret: TOTP_SECRET,
    });

    expect(token).toMatch(/^loginchallengev1_/u);
    const verified = verifyDashboardLoginChallenge(token, "totp_setup");
    expect(verified).toEqual({ ok: true, userId: USER_ID, totpSecret: TOTP_SECRET });
  });

  it("round-trips a totp_login challenge without exposing totpSecret", async () => {
    const { issueDashboardLoginChallenge, verifyDashboardLoginChallenge } = await import("./loginChallenge");

    const token = issueDashboardLoginChallenge({
      userId: USER_ID,
      stage: "totp_login",
    });

    const verified = verifyDashboardLoginChallenge(token, "totp_login");
    expect(verified).toEqual({ ok: true, userId: USER_ID });
  });

  it("rejects stage mismatches", async () => {
    const { issueDashboardLoginChallenge, verifyDashboardLoginChallenge } = await import("./loginChallenge");

    const setupToken = issueDashboardLoginChallenge({
      userId: USER_ID,
      stage: "totp_setup",
      totpSecret: TOTP_SECRET,
    });
    const loginToken = issueDashboardLoginChallenge({
      userId: USER_ID,
      stage: "totp_login",
    });

    expect(verifyDashboardLoginChallenge(setupToken, "totp_login")).toEqual({ ok: false });
    expect(verifyDashboardLoginChallenge(loginToken, "totp_setup")).toEqual({ ok: false });
  });

  it("rejects expired challenges", async () => {
    const { issueDashboardLoginChallenge, verifyDashboardLoginChallenge } = await import("./loginChallenge");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T10:00:00.000Z"));
    const token = issueDashboardLoginChallenge({
      userId: USER_ID,
      stage: "totp_login",
    });
    vi.setSystemTime(new Date("2026-07-11T10:06:00.000Z"));
    expect(verifyDashboardLoginChallenge(token, "totp_login")).toEqual({ ok: false });
  });

  it("rejects tampered and wrong-key challenges", async () => {
    const { issueDashboardLoginChallenge, verifyDashboardLoginChallenge } = await import("./loginChallenge");
    const token = issueDashboardLoginChallenge({
      userId: USER_ID,
      stage: "totp_setup",
      totpSecret: TOTP_SECRET,
    });

    const payload = Buffer.from(token.slice("loginchallengev1_".length), "base64url");
    payload[0] ^= 0xff;
    const tampered = `loginchallengev1_${payload.toString("base64url")}`;
    expect(verifyDashboardLoginChallenge(tampered, "totp_setup")).toEqual({ ok: false });

    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("DASHBOARD_LOGIN_CHALLENGE_SECRET", OTHER_CHALLENGE_SECRET);
    const { verifyDashboardLoginChallenge: verifyWithWrongKey } = await import("./loginChallenge");
    expect(verifyWithWrongKey(token, "totp_setup")).toEqual({ ok: false });
  });

  it("rejects malformed, invalid, and incomplete payloads without throwing", async () => {
    const { verifyDashboardLoginChallenge } = await import("./loginChallenge");
    const tokens = [
      "",
      "wrongprefix_abc",
      "loginchallengev1_not-base64",
      sealPayload(FAKE_CHALLENGE_SECRET, "not-json"),
      sealPayload(FAKE_CHALLENGE_SECRET, { stage: "totp_setup", totpSecret: TOTP_SECRET, expiresAt: Date.now() + 1000 }),
      sealPayload(FAKE_CHALLENGE_SECRET, { userId: USER_ID, stage: "nope", expiresAt: Date.now() + 1000 }),
      sealPayload(FAKE_CHALLENGE_SECRET, { userId: "", stage: "totp_login", expiresAt: Date.now() + 1000 }),
      sealPayload(FAKE_CHALLENGE_SECRET, { userId: USER_ID, stage: "totp_login", expiresAt: Date.now() + 1000, totpSecret: TOTP_SECRET }),
      sealPayload(FAKE_CHALLENGE_SECRET, { userId: USER_ID, stage: "totp_setup", expiresAt: Date.now() + 1000 }),
      sealPayload(FAKE_CHALLENGE_SECRET, { userId: USER_ID, stage: "totp_login", totpSecret: TOTP_SECRET, expiresAt: Date.now() + 1000 }),
      sealPayload(FAKE_CHALLENGE_SECRET, { userId: USER_ID, stage: "totp_login", expiresAt: "bad" }),
    ];

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const token of tokens) {
      expect(() => verifyDashboardLoginChallenge(token, "totp_login")).not.toThrow();
      expect(() => verifyDashboardLoginChallenge(token, "totp_setup")).not.toThrow();
      expect(verifyDashboardLoginChallenge(token, "totp_login")).toEqual({ ok: false });
      expect(verifyDashboardLoginChallenge(token, "totp_setup")).toEqual({ ok: false });
    }

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
