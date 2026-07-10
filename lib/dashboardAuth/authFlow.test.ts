import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type UserState = {
  id: string;
  email: string;
  role: "admin_ceo" | "manager_ops" | "ca";
  status: "active" | "disabled";
  totpEnabled: boolean;
  totpSecretEncrypted: string | null;
};

type OtpState = {
  id: string;
  userId: string;
  rawOtp: string;
  used: boolean;
};

type AuditCall = Record<string, unknown>;

let users: UserState[];
let otps: OtpState[];
let sessions: Array<{ userId: string; rawToken: string; expiresAt: Date }>;
let audits: AuditCall[];
let sentEmails: Array<{ to: string; otp: string }>;
let createOtpCalls: Array<{ userId: string; rawOtp: string }>;
let sessionCounter: number;
let otpCounter: number;

const TEST_TIME = new Date("2026-07-11T10:00:00.000Z");
const SESSION_TOKEN_REGEX = /^[A-Za-z0-9_-]+$/u;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function base32Decode(value: string): Buffer {
  let bits = 0;
  let bitCount = 0;
  const bytes: number[] = [];

  for (const char of value.replace(/=+$/u, "").toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(char);
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

function referenceTotp(secret: string, now: Date): string {
  const counter = Math.floor(now.getTime() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

vi.mock("@/lib/dashboardAuth/users", () => ({
  getDashboardUserByEmail: async (email: string) => {
    const normalized = normalizeEmail(email);
    return users
      .filter((user) => normalizeEmail(user.email) === normalized)
      .map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        totpEnabled: user.totpEnabled,
      }))[0] ?? null;
  },
  getDashboardUserById: async (userId: string) => {
    const user = users.find((entry) => entry.id === userId);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      totpEnabled: user.totpEnabled,
    };
  },
  getDashboardUserAuthRecordById: async (userId: string) => {
    const user = users.find((entry) => entry.id === userId);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      totpEnabled: user.totpEnabled,
      totpSecretEncrypted: user.totpSecretEncrypted,
    };
  },
  setDashboardUserTotpSecret: async (params: { userId: string; encryptedSecret: string }) => {
    const user = users.find((entry) => entry.id === params.userId);
    if (!user) return { ok: false };
    user.totpEnabled = true;
    user.totpSecretEncrypted = params.encryptedSecret;
    return { ok: true };
  },
}));

vi.mock("@/lib/dashboardAuth/otpStore", () => ({
  createDashboardEmailOtp: async (params: { userId: string; rawOtp: string }) => {
    createOtpCalls.push(params);
    const otpId = `otp-${++otpCounter}`;
    otps.push({ id: otpId, userId: params.userId, rawOtp: params.rawOtp, used: false });
    return { ok: true, otpId, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
  },
  verifyDashboardEmailOtp: async (params: { otpId: string; rawOtp: string }) => {
    const otp = otps.find((entry) => entry.id === params.otpId);
    if (!otp) return { ok: false, reason: "not_found" as const };
    if (otp.used) return { ok: false, reason: "used" as const };
    if (otp.rawOtp !== params.rawOtp) return { ok: false, reason: "incorrect" as const };
    otp.used = true;
    return { ok: true, userId: otp.userId };
  },
}));

vi.mock("@/lib/dashboardAuth/microsoftGraphOtp", () => ({
  sendDashboardOtpEmail: async (params: { to: string; otp: string }) => {
    sentEmails.push(params);
    return { ok: true };
  },
}));

vi.mock("@/lib/dashboardAuth/sessionStore", () => ({
  createDashboardSession: async (params: { userId: string; rawToken: string; expiresAt: Date }) => {
    sessions.push(params);
    return { ok: true, sessionId: `session-${++sessionCounter}` };
  },
}));

vi.mock("@/lib/dashboardAuth/auditEvents", () => ({
  recordDashboardAuthAuditEvent: async (params: AuditCall) => {
    audits.push(params);
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useFakeTimers();
  vi.setSystemTime(TEST_TIME);
  vi.stubEnv("DASHBOARD_TOTP_ENCRYPTION_KEY", "totp-flow-secret");

  users = [
    {
      id: "user-1",
      email: "admin@applywizz.ai",
      role: "admin_ceo",
      status: "active",
      totpEnabled: false,
      totpSecretEncrypted: null,
    },
    {
      id: "user-2",
      email: "ca@applywizz.ai",
      role: "ca",
      status: "disabled",
      totpEnabled: false,
      totpSecretEncrypted: null,
    },
  ];
  otps = [];
  sessions = [];
  audits = [];
  sentEmails = [];
  createOtpCalls = [];
  sessionCounter = 0;
  otpCounter = 0;
});

describe("requestDashboardLoginOtp", () => {
  it("returns the same shape for unknown, disabled, and active users while only sending email for the active user", async () => {
    const { requestDashboardLoginOtp } = await import("./authFlow");

    const unknown = await requestDashboardLoginOtp({ email: "missing@applywizz.ai", ip: "203.0.113.10", userAgent: "UA" });
    const disabled = await requestDashboardLoginOtp({ email: "ca@applywizz.ai", ip: "203.0.113.10", userAgent: "UA" });
    const active = await requestDashboardLoginOtp({ email: "admin@applywizz.ai", ip: "203.0.113.10", userAgent: "UA" });

    expect(Object.keys(unknown).sort()).toEqual(["ok", "otpId"]);
    expect(Object.keys(disabled).sort()).toEqual(["ok", "otpId"]);
    expect(Object.keys(active).sort()).toEqual(["ok", "otpId"]);
    expect(unknown.ok).toBe(true);
    expect(disabled.ok).toBe(true);
    expect(active.ok).toBe(true);
    expect(unknown.otpId).not.toBe(active.otpId);
    expect(disabled.otpId).not.toBe(active.otpId);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({ to: "admin@applywizz.ai" });
    expect(createOtpCalls).toEqual([{ userId: "user-1", rawOtp: sentEmails[0].otp }]);
    expect(JSON.stringify(audits)).not.toContain("admin@applywizz.ai");
  });
});

describe("verifyDashboardLoginOtp", () => {
  it("collapses OTP failures to ok:false", async () => {
    const { verifyDashboardLoginOtp } = await import("./authFlow");

    await expect(verifyDashboardLoginOtp({ otpId: "missing", rawOtp: "123456" })).resolves.toEqual({ ok: false });
  });

  it("fails closed when OTP succeeds but the user is missing or disabled on re-check", async () => {
    const { verifyDashboardLoginOtp } = await import("./authFlow");

    otps.push({ id: "otp-missing", userId: "missing-user", rawOtp: "123456", used: false });
    otps.push({ id: "otp-disabled", userId: "user-2", rawOtp: "123456", used: false });

    await expect(verifyDashboardLoginOtp({ otpId: "otp-missing", rawOtp: "123456" })).resolves.toEqual({
      ok: false,
    });
    await expect(verifyDashboardLoginOtp({ otpId: "otp-disabled", rawOtp: "123456" })).resolves.toEqual({
      ok: false,
    });
  });

  it("re-fetches the user by id and returns the correct TOTP stage", async () => {
    const { requestDashboardLoginOtp, verifyDashboardLoginOtp } = await import("./authFlow");

    const request = await requestDashboardLoginOtp({ email: "admin@applywizz.ai" });
    const otp = sentEmails[0].otp;
    const verify = await verifyDashboardLoginOtp({ otpId: request.otpId, rawOtp: otp });

    expect(verify.ok).toBe(true);
    if (verify.ok) {
      expect(verify.stage).toBe("totp_setup_required");
      expect(verify.userId).toBe("user-1");
      expect(verify.totpSecret).toMatch(/^[A-Z2-7]+$/u);
      expect(verify.provisioningUri).toContain("otpauth://totp/");
      expect(verify.provisioningUri).toContain("issuer=ApplyWizz+Dashboard");
    }

    const totpSecret = verify.ok ? verify.totpSecret : "";
    users[0].totpEnabled = true;
    users[0].totpSecretEncrypted = "encrypted-secret";
    const enabledRequest = await requestDashboardLoginOtp({ email: "admin@applywizz.ai" });
    const enabledOtp = sentEmails.at(-1)?.otp ?? "";
    const ready = await verifyDashboardLoginOtp({ otpId: enabledRequest.otpId, rawOtp: enabledOtp });
    expect(ready).toEqual({ ok: true, stage: "totp_required", userId: "user-1" });

    expect(totpSecret).toMatch(/^[A-Z2-7]+$/u);
  });
});

describe("completeDashboardTotpSetup and verifyDashboardLoginTotp", () => {
  it("performs the full TOTP setup and login round trip without logging secrets", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { requestDashboardLoginOtp, verifyDashboardLoginOtp, completeDashboardTotpSetup, verifyDashboardLoginTotp } =
      await import("./authFlow");
    const { decryptTotpSecret } = await import("./totp");

    const request = await requestDashboardLoginOtp({ email: "admin@applywizz.ai" });
    const rawOtp = sentEmails[0].otp;
    const verification = await verifyDashboardLoginOtp({ otpId: request.otpId, rawOtp });

    if (!verification.ok) throw new Error("expected TOTP setup stage");

    const totpCode = referenceTotp(verification.totpSecret, TEST_TIME);
    const setup = await completeDashboardTotpSetup({
      userId: verification.userId,
      totpSecret: verification.totpSecret,
      code: totpCode,
    });

    expect(setup.ok).toBe(true);
    if (setup.ok) {
      expect(setup.sessionToken).toMatch(SESSION_TOKEN_REGEX);
      expect(sessions[0]).toMatchObject({
        userId: verification.userId,
        rawToken: setup.sessionToken,
      });
      expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(TEST_TIME.getTime());
    }

    const storedSecret = users[0].totpSecretEncrypted;
    expect(storedSecret).toBeTruthy();
    expect(storedSecret).not.toBe(verification.totpSecret);
    expect(storedSecret && decryptTotpSecret(storedSecret)).toBe(verification.totpSecret);

    const loginCode = referenceTotp(verification.totpSecret, TEST_TIME);
    const login = await verifyDashboardLoginTotp({ userId: verification.userId, code: loginCode });
    expect(login.ok).toBe(true);
    if (login.ok) {
      expect(login.sessionToken).toMatch(SESSION_TOKEN_REGEX);
      expect(login.sessionToken).not.toBe(setup.ok ? setup.sessionToken : "");
    }

    expect(JSON.stringify(audits)).not.toContain(rawOtp);
    expect(JSON.stringify(audits)).not.toContain(totpCode);
    expect(JSON.stringify(audits)).not.toContain(verification.totpSecret);
    expect(JSON.stringify(audits)).not.toContain(verification.provisioningUri);
    expect(JSON.stringify(audits)).not.toContain(setup.ok ? setup.sessionToken : "");
    expect(JSON.stringify(audits)).not.toContain(login.ok ? login.sessionToken : "");
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("fails closed for missing or disabled users and for invalid TOTP state", async () => {
    const { completeDashboardTotpSetup, verifyDashboardLoginTotp } = await import("./authFlow");

    await expect(
      completeDashboardTotpSetup({ userId: "missing", totpSecret: "JBSWY3DPEHPK3PXP", code: "123456" }),
    ).resolves.toEqual({ ok: false });
    await expect(
      verifyDashboardLoginTotp({ userId: "missing", code: "123456" }),
    ).resolves.toEqual({ ok: false });

    await expect(
      completeDashboardTotpSetup({ userId: "user-2", totpSecret: "JBSWY3DPEHPK3PXP", code: "123456" }),
    ).resolves.toEqual({ ok: false });
    await expect(verifyDashboardLoginTotp({ userId: "user-2", code: "123456" })).resolves.toEqual({ ok: false });
  });
});
