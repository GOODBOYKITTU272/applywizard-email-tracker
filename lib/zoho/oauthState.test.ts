/**
 * Unit tests for the Zoho OAuth state signing helper.
 * Pure crypto — no network, no Supabase, no Next.js request/response objects.
 */

import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const SECRET = "zoho-oauth-state-test-secret-32-bytes-minimum!!";
const OTHER_SECRET = "a-completely-different-test-secret-also-32-bytes";

function payload() {
  return { csrf: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", mailbox: "tracker@applywizard.ai", recovery: true };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("ZOHO_OAUTH_STATE_SECRET", SECRET);
});

describe("createZohoOAuthState / verifyZohoOAuthState — signing and verification", () => {
  it("a validly signed state verifies successfully", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState(payload());
    const result = verifyZohoOAuthState(token);
    expect(result.ok).toBe(true);
  });

  it("mailbox survives signing and verification", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState(payload());
    const result = verifyZohoOAuthState(token);
    expect(result.ok && result.state.mailbox).toBe("tracker@applywizard.ai");
  });

  it("recovery flag survives signing and verification", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const trueToken = createZohoOAuthState(payload());
    const falseToken = createZohoOAuthState({ ...payload(), recovery: false });
    expect((verifyZohoOAuthState(trueToken) as { ok: true; state: { recovery: boolean } }).state.recovery).toBe(true);
    expect((verifyZohoOAuthState(falseToken) as { ok: true; state: { recovery: boolean } }).state.recovery).toBe(false);
  });

  it("csrf survives signing and verification", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState(payload());
    const result = verifyZohoOAuthState(token);
    expect(result.ok && result.state.csrf).toBe(payload().csrf);
  });

  it("issued-at and expiry are embedded and enforced", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const now = 1_700_000_000_000;
    const token = createZohoOAuthState(payload(), now);

    const stillValid = verifyZohoOAuthState(token, now + 5 * 60_000); // +5 min, within window
    expect(stillValid.ok).toBe(true);

    const afterExpiry = verifyZohoOAuthState(token, now + 11 * 60_000); // +11 min, past 10-min window
    expect(afterExpiry.ok).toBe(false);
  });

  it("normalizes mailbox case/whitespace consistently before signing", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState({ ...payload(), mailbox: "  Tracker@ApplyWizard.AI  " });
    const result = verifyZohoOAuthState(token);
    expect(result.ok && result.state.mailbox).toBe("tracker@applywizard.ai");
  });
});

describe("verifyZohoOAuthState — tampering", () => {
  function tamperField(token: string, field: string, value: unknown): string {
    const [version, encodedPayload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    claims[field] = value;
    const tamperedPayload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    // Signature intentionally NOT recomputed — simulates an attacker without the secret.
    return `${version}.${tamperedPayload}.${signature}`;
  }

  it("modifying mailbox invalidates the signature", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState(payload());
    const tampered = tamperField(token, "mailbox", "attacker@applywizard.ai");
    expect(verifyZohoOAuthState(tampered).ok).toBe(false);
  });

  it("modifying recovery invalidates the signature", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState({ ...payload(), recovery: false });
    const tampered = tamperField(token, "recovery", true);
    expect(verifyZohoOAuthState(tampered).ok).toBe(false);
  });

  it("modifying csrf invalidates the signature", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState(payload());
    const tampered = tamperField(token, "csrf", "11111111-1111-4111-8111-111111111111");
    expect(verifyZohoOAuthState(tampered).ok).toBe(false);
  });

  it("modifying exp invalidates the signature", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState(payload());
    const tampered = tamperField(token, "exp", Date.now() + 999 * 24 * 60 * 60_000);
    expect(verifyZohoOAuthState(tampered).ok).toBe(false);
  });

  it("changing one signature byte is rejected", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState(payload());
    const [version, encodedPayload, signature] = token.split(".");
    const flippedChar = signature[0] === "A" ? "B" : "A";
    const tampered = `${version}.${encodedPayload}.${flippedChar}${signature.slice(1)}`;
    expect(verifyZohoOAuthState(tampered).ok).toBe(false);
  });

  it("a missing signature segment is rejected", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState(payload());
    const [version, encodedPayload] = token.split(".");
    expect(verifyZohoOAuthState(`${version}.${encodedPayload}`).ok).toBe(false);
    expect(verifyZohoOAuthState(`${version}.${encodedPayload}.`).ok).toBe(false);
  });

  it("malformed base64url is rejected", async () => {
    const { verifyZohoOAuthState } = await import("./oauthState");
    expect(verifyZohoOAuthState("v1.not base64url!!.also not base64url??").ok).toBe(false);
    expect(verifyZohoOAuthState("v1.has+plus/slash=pad.abcXYZ012").ok).toBe(false);
  });

  it("malformed JSON inside a validly-signed payload is rejected", async () => {
    const { verifyZohoOAuthState } = await import("./oauthState");
    const garbage = Buffer.from("not valid json{{{", "utf8").toString("base64url");
    const sig = createHmac("sha256", SECRET).update(garbage).digest("base64url");
    expect(verifyZohoOAuthState(`v1.${garbage}.${sig}`).ok).toBe(false);
  });

  it("unknown state version is rejected", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState(payload());
    const [, encodedPayload, signature] = token.split(".");
    expect(verifyZohoOAuthState(`v2.${encodedPayload}.${signature}`).ok).toBe(false);
  });

  it("expired state is rejected", async () => {
    const { createZohoOAuthState, verifyZohoOAuthState } = await import("./oauthState");
    const now = 1_700_000_000_000;
    const token = createZohoOAuthState(payload(), now);
    expect(verifyZohoOAuthState(token, now + 15 * 60_000).ok).toBe(false);
  });

  it("state issued implausibly far in the future is rejected", async () => {
    const { verifyZohoOAuthState } = await import("./oauthState");
    const now = 1_700_000_000_000;
    const futureClaims = { ...payload(), iat: now + 60 * 60_000, exp: now + 70 * 60_000 };
    const encodedPayload = Buffer.from(JSON.stringify(futureClaims), "utf8").toString("base64url");
    const sig = createHmac("sha256", SECRET).update(encodedPayload).digest("base64url");
    expect(verifyZohoOAuthState(`v1.${encodedPayload}.${sig}`, now).ok).toBe(false);
  });

  it("a token signed with a different secret is rejected", async () => {
    const { verifyZohoOAuthState } = await import("./oauthState");
    const claims = { ...payload(), iat: Date.now(), exp: Date.now() + 60_000 };
    const encodedPayload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const sig = createHmac("sha256", OTHER_SECRET).update(encodedPayload).digest("base64url");
    expect(verifyZohoOAuthState(`v1.${encodedPayload}.${sig}`).ok).toBe(false);
  });
});

describe("Zoho OAuth state secret handling", () => {
  it("missing signing secret fails safely — throws, does not fall back silently", async () => {
    vi.unstubAllEnvs();
    const { createZohoOAuthState } = await import("./oauthState");
    expect(() => createZohoOAuthState(payload())).toThrow();
  });

  it("a weak (short) signing secret fails validation", async () => {
    vi.stubEnv("ZOHO_OAUTH_STATE_SECRET", "too-short");
    const { createZohoOAuthState } = await import("./oauthState");
    expect(() => createZohoOAuthState(payload())).toThrow();
  });

  it("error messages never contain the signing secret", async () => {
    vi.unstubAllEnvs();
    const { createZohoOAuthState } = await import("./oauthState");
    try {
      createZohoOAuthState(payload());
      expect.fail("expected createZohoOAuthState to throw");
    } catch (error) {
      expect(error instanceof Error ? error.message : String(error)).not.toContain(SECRET);
    }
  });

  it("signed state output never contains the raw signing secret", async () => {
    const { createZohoOAuthState } = await import("./oauthState");
    const token = createZohoOAuthState(payload());
    expect(token).not.toContain(SECRET);
    expect(Buffer.from(token, "utf8").toString("base64")).not.toContain(Buffer.from(SECRET).toString("base64"));
  });
});
