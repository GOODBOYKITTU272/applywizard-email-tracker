import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getDashboardTotpEncryptionKey } from "@/lib/dashboardAuth/config";

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_SECRET_BYTES = 20;
const TOTP_ENCRYPTION_PREFIX = "totpv1_";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Buffer): string {
  let value = 0;
  let bits = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(secret: string): Buffer | null {
  let value = 0;
  let bits = 0;
  const bytes: number[] = [];
  const normalized = secret.replace(/=+$/u, "").replace(/\s+/gu, "").toUpperCase();

  if (!normalized) return null;

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function hotpCode(secret: Buffer, counter: number): string | null {
  if (!Number.isInteger(counter) || counter < 0) return null;

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function timingSafeDigitCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeCode(code: string): string | null {
  if (!/^\d{1,6}$/u.test(code)) return null;
  return code.padStart(TOTP_DIGITS, "0");
}

function deriveEncryptionKey(): Buffer {
  return createHash("sha256").update(getDashboardTotpEncryptionKey(), "utf8").digest();
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

export function buildTotpProvisioningUri(params: { email: string; secret: string }): string {
  const label = `ApplyWizz Dashboard:${params.email}`;
  const uri = new URL(`otpauth://totp/${encodeURIComponent(label)}`);
  uri.searchParams.set("secret", params.secret);
  uri.searchParams.set("issuer", "ApplyWizz Dashboard");
  uri.searchParams.set("algorithm", "SHA1");
  uri.searchParams.set("digits", String(TOTP_DIGITS));
  uri.searchParams.set("period", String(TOTP_PERIOD_SECONDS));
  return uri.toString();
}

export function verifyTotpCode(params: { secret: string; code: string; now?: Date }): boolean {
  try {
    const secretBytes = base32Decode(params.secret);
    const normalizedCode = normalizeCode(params.code);
    if (!secretBytes || !normalizedCode) return false;

    const now = params.now ?? new Date();
    const counter = Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
    for (const offset of [-1, 0, 1]) {
      const candidate = hotpCode(secretBytes, counter + offset);
      if (candidate && timingSafeDigitCompare(candidate, normalizedCode)) return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${TOTP_ENCRYPTION_PREFIX}${Buffer.concat([iv, authTag, ciphertext]).toString("base64url")}`;
}

export function decryptTotpSecret(encrypted: string): string | null {
  if (!encrypted.startsWith(TOTP_ENCRYPTION_PREFIX)) return null;

  try {
    const payload = Buffer.from(encrypted.slice(TOTP_ENCRYPTION_PREFIX.length), "base64url");
    if (payload.length <= 28) return null;

    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", deriveEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
