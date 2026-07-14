import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const FAKE_SECRET_KEY = "totp-encryption-key";
const FAKE_EMAIL = "staff.member@applywizz.ai";
const BASE32_SECRET = "JBSWY3DPEHPK3PXP";
const TEST_TIME = new Date("2026-07-10T12:00:00.000Z");
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Decode(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let bitCount = 0;
  const bytes: number[] = [];

  for (const char of value.replace(/=+$/u, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("invalid base32");
    bits = (bits << 5) | index;
    bitCount += 5;

    while (bitCount >= 8) {
      bytes.push((bits >> (bitCount - 8)) & 0xff);
      bitCount -= 8;
    }
  }

  return Buffer.from(bytes);
}

function referenceTotp(secret: string, time: Date): string {
  const counter = Math.floor(time.getTime() / 1000 / STEP_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generateTotpSecret", () => {
  it("returns a non-empty base32 secret", async () => {
    const { generateTotpSecret } = await import("./totp");
    const secret = generateTotpSecret();

    expect(secret).toMatch(/^[A-Z2-7]+$/u);
    expect(secret.length).toBeGreaterThan(0);
  });
});

describe("TOTP encryption", () => {
  it("encrypts and decrypts the secret exactly", async () => {
    vi.stubEnv("DASHBOARD_TOTP_ENCRYPTION_KEY", FAKE_SECRET_KEY);
    const { encryptTotpSecret, decryptTotpSecret } = await import("./totp");

    const encrypted = encryptTotpSecret(BASE32_SECRET);
    expect(encrypted).not.toBe(BASE32_SECRET);
    expect(decryptTotpSecret(encrypted)).toBe(BASE32_SECRET);
  });

  it("returns null for tampered ciphertext", async () => {
    vi.stubEnv("DASHBOARD_TOTP_ENCRYPTION_KEY", FAKE_SECRET_KEY);
    const { encryptTotpSecret, decryptTotpSecret } = await import("./totp");

    const encrypted = encryptTotpSecret(BASE32_SECRET);
    const payload = Buffer.from(encrypted.slice("totpv1_".length), "base64url");
    payload[0] ^= 0xff;
    const corrupted = `totpv1_${payload.toString("base64url")}`;

    expect(decryptTotpSecret(corrupted)).toBeNull();
  });

  it("returns null when decrypted with the wrong key", async () => {
    vi.stubEnv("DASHBOARD_TOTP_ENCRYPTION_KEY", FAKE_SECRET_KEY);
    const { encryptTotpSecret } = await import("./totp");
    const encrypted = encryptTotpSecret(BASE32_SECRET);

    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("DASHBOARD_TOTP_ENCRYPTION_KEY", "different-key");
    const { decryptTotpSecret } = await import("./totp");

    expect(decryptTotpSecret(encrypted)).toBeNull();
  });
});

describe("buildTotpProvisioningUri", () => {
  it("includes issuer and email in the otpauth URI", async () => {
    const { buildTotpProvisioningUri } = await import("./totp");
    const uri = buildTotpProvisioningUri({ email: FAKE_EMAIL, secret: BASE32_SECRET });

    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("issuer=ApplyWizz+Dashboard");
    expect(uri).toContain(encodeURIComponent(FAKE_EMAIL));
    expect(uri).toContain(`secret=${BASE32_SECRET}`);
  });
});

describe("verifyTotpCode", () => {
  it("verifies the correct code at a fixed time and tolerates adjacent steps", async () => {
    const { verifyTotpCode } = await import("./totp");
    const currentCode = referenceTotp(BASE32_SECRET, TEST_TIME);
    const previousCode = referenceTotp(BASE32_SECRET, new Date(TEST_TIME.getTime() - STEP_SECONDS * 1000));
    const nextCode = referenceTotp(BASE32_SECRET, new Date(TEST_TIME.getTime() + STEP_SECONDS * 1000));
    const tooFarCode = referenceTotp(BASE32_SECRET, new Date(TEST_TIME.getTime() + STEP_SECONDS * 2000));

    expect(verifyTotpCode({ secret: BASE32_SECRET, code: currentCode, now: TEST_TIME })).toBe(true);
    expect(verifyTotpCode({ secret: BASE32_SECRET, code: previousCode, now: TEST_TIME })).toBe(true);
    expect(verifyTotpCode({ secret: BASE32_SECRET, code: nextCode, now: TEST_TIME })).toBe(true);
    expect(verifyTotpCode({ secret: BASE32_SECRET, code: tooFarCode, now: TEST_TIME })).toBe(false);
    expect(verifyTotpCode({ secret: BASE32_SECRET, code: "000000", now: TEST_TIME })).toBe(false);
  });

  it("does not log during success or failure paths", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { verifyTotpCode } = await import("./totp");
    const currentCode = referenceTotp(BASE32_SECRET, TEST_TIME);

    expect(verifyTotpCode({ secret: BASE32_SECRET, code: currentCode, now: TEST_TIME })).toBe(true);
    expect(verifyTotpCode({ secret: BASE32_SECRET, code: "000000", now: TEST_TIME })).toBe(false);

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
