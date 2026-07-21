import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

/**
 * HMAC-signed, versioned OAuth state — replaces the raw-JSON `zoho_oauth_state`
 * cookie. Cookie flags (httpOnly/secure/sameSite) protect the cookie in
 * transit but do not prove the app produced the mailbox/recovery values
 * inside it; a signature is required so the callback can trust them.
 *
 * Deliberately its own dedicated secret (ZOHO_OAUTH_STATE_SECRET), not
 * DASHBOARD_SESSION_SECRET (long-lived session-token hashing) or
 * DASHBOARD_LOGIN_CHALLENGE_SECRET (a different, pre-auth subsystem) —
 * mirrors this codebase's existing convention of one dedicated secret per
 * distinct signed/encrypted short-lived token type, so a compromise of one
 * domain's secret does not weaken another's.
 *
 * Format: v1.<base64url(payload-json)>.<base64url(hmac-sha256 signature)>
 * The signature covers the exact encoded-payload string, so any change to
 * any claim (csrf, mailbox, recovery, iat, exp) invalidates it.
 */

const STATE_VERSION = "v1";
const VALIDITY_WINDOW_MS = 10 * 60 * 1000; // matches the cookie's own 600s maxAge
const MAX_FUTURE_SKEW_MS = 60 * 1000;
const MIN_SECRET_BYTES = 32;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

export interface ZohoOAuthStatePayload {
  csrf: string;
  mailbox: string;
  recovery: boolean;
}

export interface ZohoOAuthStateClaims extends ZohoOAuthStatePayload {
  iat: number;
  exp: number;
}

export type VerifyZohoOAuthStateResult = { ok: true; state: ZohoOAuthStateClaims } | { ok: false };

/**
 * Strength enforcement is unconditional — not relaxed in dev/test — a
 * misconfigured NODE_ENV must never silently weaken this. Tests inject a
 * deterministic fake secret of sufficient length via ZOHO_OAUTH_STATE_SECRET.
 */
function getZohoOAuthStateSecret(): string {
  const secret = process.env.ZOHO_OAUTH_STATE_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new Error("ZOHO_OAUTH_STATE_SECRET is not configured or is too weak.");
  }
  return secret;
}

function sign(secret: string, encodedPayload: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function createZohoOAuthState(payload: ZohoOAuthStatePayload, now = Date.now()): string {
  const secret = getZohoOAuthStateSecret();

  const claims: ZohoOAuthStateClaims = {
    csrf: payload.csrf,
    mailbox: payload.mailbox.trim().toLowerCase(),
    recovery: payload.recovery,
    iat: now,
    exp: now + VALIDITY_WINDOW_MS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = sign(secret, encodedPayload);
  return `${STATE_VERSION}.${encodedPayload}.${signature}`;
}

export function verifyZohoOAuthState(token: string, now = Date.now()): VerifyZohoOAuthStateResult {
  try {
    const secret = getZohoOAuthStateSecret();
    if (typeof token !== "string" || !token) return { ok: false };

    const parts = token.split(".");
    if (parts.length !== 3) return { ok: false };
    const [version, encodedPayload, signature] = parts;

    if (version !== STATE_VERSION) return { ok: false };
    if (!encodedPayload || !signature) return { ok: false };
    if (!BASE64URL_RE.test(encodedPayload) || !BASE64URL_RE.test(signature)) return { ok: false };

    const expected = Buffer.from(sign(secret, encodedPayload), "base64url");
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    } catch {
      return { ok: false };
    }
    if (typeof parsed !== "object" || parsed === null) return { ok: false };

    const record = parsed as Record<string, unknown>;
    if (typeof record.csrf !== "string" || !record.csrf) return { ok: false };
    if (typeof record.mailbox !== "string") return { ok: false };
    if (typeof record.recovery !== "boolean") return { ok: false };
    if (typeof record.iat !== "number" || !Number.isFinite(record.iat)) return { ok: false };
    if (typeof record.exp !== "number" || !Number.isFinite(record.exp)) return { ok: false };

    // exp must actually derive from iat + the configured window — rejects a
    // forged-but-correctly-signed-by-nobody-else scenario is impossible once
    // the signature check above passes, but this also guards against a
    // legitimately-signed token whose window was widened by a future bug.
    if (record.exp <= record.iat || record.exp - record.iat > VALIDITY_WINDOW_MS) return { ok: false };
    if (record.iat > now + MAX_FUTURE_SKEW_MS) return { ok: false };
    if (record.exp < now) return { ok: false };

    return {
      ok: true,
      state: {
        csrf: record.csrf,
        mailbox: record.mailbox,
        recovery: record.recovery,
        iat: record.iat,
        exp: record.exp,
      },
    };
  } catch {
    return { ok: false };
  }
}
