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
  invalidated: boolean;
};

type CronLockRow = { lock_key: string; started_at: string; owner_token: string };

type AuditCall = Record<string, unknown>;

let users: UserState[];
let otps: OtpState[];
let sessions: Array<{ userId: string; rawToken: string; expiresAt: Date }>;
let audits: AuditCall[];
let sentEmails: Array<{ to: string; otp: string }>;
let createOtpCalls: Array<{ userId: string; rawOtp: string }>;
let sessionCounter: number;
let otpCounter: number;
let userLookupCalls: number;
let userAuthLookupCalls: number;
let setTotpSecretCalls: number;
let otpRequestThrottleChecks: number;
let totpSetupThrottleChecks: number;
let totpLoginThrottleChecks: number;
let invalidatedOtps: string[];
let cronLocks: CronLockRow[];
let nextOtpInsertResult: { ok: false } | null;
let nextEmailSendResult: { ok: false; reason: "explicit_failure" | "timeout_or_unknown" } | null;
let pendingFirstEmailGate: Promise<void> | null;
let loginStartLockBackendUnreachable: boolean;

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
  getOrCreateDashboardUserForLogin: async (email: string) => {
    const normalized = normalizeEmail(email);
    if (!normalized.endsWith("@applywizz.ai") || normalized.includes("+")) return null;

    const existing = users.find((user) => normalizeEmail(user.email) === normalized);
    if (existing) {
      return {
        created: false,
        user: {
          id: existing.id,
          email: existing.email,
          role: existing.role,
          status: existing.status,
          totpEnabled: existing.totpEnabled,
        },
      };
    }

    const created: UserState = {
      id: `user-${users.length + 1}`,
      email: normalized,
      role: "ca",
      status: "active",
      totpEnabled: false,
      totpSecretEncrypted: null,
    };
    users.push(created);
    return {
      created: true,
      user: { id: created.id, email: created.email, role: created.role, status: created.status, totpEnabled: false },
    };
  },
  getDashboardUserById: async (userId: string) => {
    userLookupCalls += 1;
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
    userAuthLookupCalls += 1;
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
    setTotpSecretCalls += 1;
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
    if (nextOtpInsertResult) {
      const result = nextOtpInsertResult;
      nextOtpInsertResult = null;
      return result;
    }
    const otpId = `otp-${++otpCounter}`;
    otps.push({ id: otpId, userId: params.userId, rawOtp: params.rawOtp, used: false, invalidated: false });
    return { ok: true, otpId, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
  },
  verifyDashboardEmailOtp: async (params: { otpId: string; rawOtp: string }) => {
    const otp = otps.find((entry) => entry.id === params.otpId);
    if (!otp) return { ok: false, reason: "not_found" as const };
    if (otp.used || otp.invalidated) return { ok: false, reason: "used" as const };
    if (otp.rawOtp !== params.rawOtp) return { ok: false, reason: "incorrect" as const };
    otp.used = true;
    return { ok: true, userId: otp.userId };
  },
  getLatestUsableDashboardEmailOtp: async (userId: string) => {
    const usable = [...otps].reverse().find((entry) => entry.userId === userId && !entry.used && !entry.invalidated);
    if (!usable) return { ok: false as const };
    return { ok: true as const, challengeId: usable.id, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
  },
  invalidateDashboardEmailOtp: async (otpId: string) => {
    invalidatedOtps.push(otpId);
    const otp = otps.find((entry) => entry.id === otpId);
    if (otp) otp.invalidated = true;
    return { ok: true };
  },
}));

vi.mock("@/lib/dashboardAuth/microsoftGraphOtp", () => ({
  sendDashboardOtpEmail: async (params: { to: string; otp: string }) => {
    if (pendingFirstEmailGate) {
      const gate = pendingFirstEmailGate;
      pendingFirstEmailGate = null;
      await gate;
    }
    if (nextEmailSendResult) {
      const result = nextEmailSendResult;
      nextEmailSendResult = null;
      return result;
    }
    sentEmails.push(params);
    return { ok: true };
  },
}));

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => {
    if (loginStartLockBackendUnreachable) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
    }
    return {
      from: (table: string) => {
        if (table !== "cron_locks") throw new Error(`unexpected table ${table}`);
        return {
          delete: () => {
            const eqFilters: Record<string, string> = {};
            let ltFilter: { column: keyof CronLockRow; value: string } | null = null;
            const chain = {
              eq: (column: string, value: string) => {
                eqFilters[column] = value;
                return chain;
              },
              lt: (column: keyof CronLockRow, value: string) => {
                ltFilter = { column, value };
                return chain;
              },
              then: (resolve: (value: { error: null }) => void) => {
                cronLocks = cronLocks.filter((row) => {
                  const matchesEq = Object.entries(eqFilters).every(
                    ([column, value]) => row[column as keyof CronLockRow] === value,
                  );
                  const matchesLt = ltFilter
                    ? new Date(row[ltFilter.column]).getTime() < new Date(ltFilter.value).getTime()
                    : true;
                  return !(matchesEq && matchesLt);
                });
                resolve({ error: null });
              },
            };
            return chain;
          },
          insert: async (row: CronLockRow) => {
            if (cronLocks.some((existing) => existing.lock_key === row.lock_key)) {
              return { error: { code: "23505", message: "duplicate key" } };
            }
            cronLocks.push(row);
            return { error: null };
          },
        };
      },
    };
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

vi.mock("@/lib/dashboardAuth/rateLimit", () => ({
  isDashboardLoginOtpRequestThrottled: async (userId: string) => {
    otpRequestThrottleChecks += 1;
    return audits.filter((event) => event.userId === userId && event.eventType === "login_otp_requested").length >= 3;
  },
  isDashboardTotpSetupThrottled: async (userId: string) => {
    totpSetupThrottleChecks += 1;
    return (
      audits.filter(
        (event) => event.userId === userId && event.eventType === "totp_setup_completed" && event.success === false,
      ).length >= 5
    );
  },
  isDashboardTotpLoginThrottled: async (userId: string) => {
    totpLoginThrottleChecks += 1;
    return (
      audits.filter(
        (event) => event.userId === userId && event.eventType === "login_totp_verify" && event.success === false,
      ).length >= 5
    );
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useFakeTimers();
  vi.setSystemTime(TEST_TIME);
  vi.stubEnv("DASHBOARD_TOTP_ENCRYPTION_KEY", "totp-flow-secret");
  vi.stubEnv("DASHBOARD_LOGIN_CHALLENGE_SECRET", "login-challenge-secret");

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
  userLookupCalls = 0;
  userAuthLookupCalls = 0;
  setTotpSecretCalls = 0;
  otpRequestThrottleChecks = 0;
  totpSetupThrottleChecks = 0;
  totpLoginThrottleChecks = 0;
  invalidatedOtps = [];
  cronLocks = [];
  nextOtpInsertResult = null;
  nextEmailSendResult = null;
  pendingFirstEmailGate = null;
  loginStartLockBackendUnreachable = false;
});

function failNextOtpInsert(): void {
  nextOtpInsertResult = { ok: false };
}

function failNextOtpEmailSend(): void {
  nextEmailSendResult = { ok: false, reason: "explicit_failure" };
}

function timeoutAfterPotentialProviderAcceptance(): void {
  nextEmailSendResult = { ok: false, reason: "timeout_or_unknown" };
}

function deferFirstLoginStartLockRelease(): { release: () => void } {
  let release!: () => void;
  pendingFirstEmailGate = new Promise((resolve) => {
    release = resolve;
  });
  return { release };
}

describe("startDashboardLogin", () => {
  it("auto-provisions a first-time applywizz user, sends email OTP, and creates no session", async () => {
    const { startDashboardLogin } = await import("./authFlow");
    const result = await startDashboardLogin({ email: "new.ca@applywizz.ai" });

    expect(result).toEqual({ ok: true, nextStep: "email_otp", challengeId: expect.any(String) });
    expect(sentEmails).toHaveLength(1);
    expect(createOtpCalls).toHaveLength(1);
    expect(sessions).toHaveLength(0);
    expect(audits).toContainEqual(expect.objectContaining({ eventType: "account_auto_provisioned", success: true }));
  });

  it("does not create a false auto-provision audit event for existing users", async () => {
    const { startDashboardLogin } = await import("./authFlow");
    await startDashboardLogin({ email: "admin@applywizz.ai" });
    expect(audits.filter((event) => event.eventType === "account_auto_provisioned")).toHaveLength(0);
  });

  it("serializes concurrent first-login starts so only one OTP and email are issued", async () => {
    vi.useRealTimers();
    const firstLock = deferFirstLoginStartLockRelease();
    const { startDashboardLogin } = await import("./authFlow");
    const starts = Promise.all([
      startDashboardLogin({ email: "race@applywizz.ai" }),
      startDashboardLogin({ email: "race@applywizz.ai" }),
    ]);
    firstLock.release();
    const [first, second] = await starts;

    if (first.nextStep !== "email_otp" || second.nextStep !== "email_otp") {
      throw new Error("expected both concurrent starts to resolve to email_otp");
    }
    expect(second.challengeId).toBe(first.challengeId);
    expect(audits.filter((event) => event.eventType === "account_auto_provisioned")).toHaveLength(1);
    expect(createOtpCalls).toHaveLength(1);
    expect(sentEmails).toHaveLength(1);
  });

  it("routes returning TOTP users directly to authenticator login with no email OTP", async () => {
    users[0].totpEnabled = true;
    users[0].totpSecretEncrypted = "encrypted-secret";

    const { startDashboardLogin } = await import("./authFlow");
    const result = await startDashboardLogin({ email: "admin@applywizz.ai" });

    expect(result).toEqual({ ok: true, nextStep: "totp", challenge: expect.stringMatching(/^loginchallengev1_/u) });
    expect(sentEmails).toHaveLength(0);
    expect(createOtpCalls).toHaveLength(0);
    expect(sessions).toHaveLength(0);
  });

  it("blocks inactive users without reactivation, OTP, TOTP challenge, or session", async () => {
    const { startDashboardLogin } = await import("./authFlow");
    const result = await startDashboardLogin({ email: "ca@applywizz.ai" });

    expect(result).toEqual({ ok: true, nextStep: "email_otp", challengeId: expect.any(String) });
    expect(sentEmails).toHaveLength(0);
    expect(createOtpCalls).toHaveLength(0);
    expect(sessions).toHaveLength(0);
  });

  it("returns the same shape for an unknown external-domain email without sending an OTP", async () => {
    const { startDashboardLogin } = await import("./authFlow");
    const result = await startDashboardLogin({ email: "missing@gmail.com" });

    expect(result).toEqual({ ok: true, nextStep: "email_otp", challengeId: expect.any(String) });
    expect(sentEmails).toHaveLength(0);
    expect(createOtpCalls).toHaveLength(0);
  });

  it("blocks a pre-existing active row whose email is no longer policy-eligible", async () => {
    users.push({
      id: "user-3",
      email: "user+test@applywizz.ai",
      role: "ca",
      status: "active",
      totpEnabled: false,
      totpSecretEncrypted: null,
    });

    const { startDashboardLogin } = await import("./authFlow");
    const result = await startDashboardLogin({ email: "user+test@applywizz.ai" });

    expect(result).toEqual({ ok: true, nextStep: "email_otp", challengeId: expect.any(String) });
    expect(sentEmails).toHaveLength(0);
    expect(createOtpCalls).toHaveLength(0);
    expect(sessions).toHaveLength(0);
    expect(audits.filter((event) => event.eventType === "account_auto_provisioned")).toHaveLength(0);
  });

  it("returns the same shape for a throttled active user without sending email", async () => {
    audits.push(
      { userId: "user-1", eventType: "login_otp_requested", success: true },
      { userId: "user-1", eventType: "login_otp_requested", success: true },
      { userId: "user-1", eventType: "login_otp_requested", success: false },
    );

    const { startDashboardLogin } = await import("./authFlow");
    const throttled = await startDashboardLogin({ email: "admin@applywizz.ai" });

    expect(throttled).toEqual({ ok: true, nextStep: "email_otp", challengeId: expect.any(String) });
    expect(otpRequestThrottleChecks).toBe(1);
    expect(sentEmails).toHaveLength(0);
    expect(createOtpCalls).toHaveLength(0);
  });

  it("does not call email provider when OTP challenge creation fails", async () => {
    failNextOtpInsert();
    const { startDashboardLogin } = await import("./authFlow");
    await expect(startDashboardLogin({ email: "new.ca@applywizz.ai" })).resolves.toEqual({
      ok: true,
      nextStep: "email_otp",
      challengeId: expect.any(String),
    });
    expect(sentEmails).toHaveLength(0);
    expect(sessions).toHaveLength(0);
    expect(audits).toContainEqual(expect.objectContaining({ eventType: "login_otp_requested", success: false }));
  });

  it("does not create a second user or provisioning audit after explicit email-provider failure", async () => {
    failNextOtpEmailSend();
    const { startDashboardLogin } = await import("./authFlow");
    const first = await startDashboardLogin({ email: "new.ca@applywizz.ai" });
    const second = await startDashboardLogin({ email: "new.ca@applywizz.ai" });
    expect(users.filter((user) => user.email === "new.ca@applywizz.ai")).toHaveLength(1);
    expect(audits.filter((event) => event.eventType === "account_auto_provisioned")).toHaveLength(1);
    expect(invalidatedOtps).toHaveLength(1);
    if (first.nextStep !== "email_otp" || second.nextStep !== "email_otp") throw new Error("expected email_otp");
    expect(second.challengeId).not.toBe(first.challengeId);
    expect(sentEmails).toHaveLength(1);
  });

  it("reuses an active OTP after provider timeout instead of blindly issuing another immediately", async () => {
    timeoutAfterPotentialProviderAcceptance();
    const { startDashboardLogin } = await import("./authFlow");
    const first = await startDashboardLogin({ email: "new.ca@applywizz.ai" });
    const second = await startDashboardLogin({ email: "new.ca@applywizz.ai" });
    expect(second).toEqual(first);
    expect(createOtpCalls).toHaveLength(1);
  });

  it("fails closed to the generic response when the login-start lock backend is unreachable", async () => {
    loginStartLockBackendUnreachable = true;
    const { startDashboardLogin } = await import("./authFlow");

    await expect(startDashboardLogin({ email: "admin@applywizz.ai" })).resolves.toEqual({
      ok: true,
      nextStep: "email_otp",
      challengeId: expect.any(String),
    });
    expect(sentEmails).toHaveLength(0);
    expect(createOtpCalls).toHaveLength(0);
    expect(sessions).toHaveLength(0);
  });
});

describe("verifyDashboardLoginOtp", () => {
  it("collapses OTP failures to ok:false", async () => {
    const { verifyDashboardLoginOtp } = await import("./authFlow");

    await expect(verifyDashboardLoginOtp({ otpId: "missing", rawOtp: "123456" })).resolves.toEqual({ ok: false });
  });

  it("fails closed when OTP succeeds but the user is missing or disabled on re-check", async () => {
    const { verifyDashboardLoginOtp } = await import("./authFlow");

    otps.push({ id: "otp-missing", userId: "missing-user", rawOtp: "123456", used: false, invalidated: false });
    otps.push({ id: "otp-disabled", userId: "user-2", rawOtp: "123456", used: false, invalidated: false });

    await expect(verifyDashboardLoginOtp({ otpId: "otp-missing", rawOtp: "123456" })).resolves.toEqual({
      ok: false,
    });
    await expect(verifyDashboardLoginOtp({ otpId: "otp-disabled", rawOtp: "123456" })).resolves.toEqual({
      ok: false,
    });
  });

  it("returns a setup challenge for first-time users", async () => {
    const { startDashboardLogin, verifyDashboardLoginOtp } = await import("./authFlow");

    const request = await startDashboardLogin({ email: "admin@applywizz.ai" });
    if (request.nextStep !== "email_otp") throw new Error("expected email OTP stage");
    const otp = sentEmails[0].otp;
    const verify = await verifyDashboardLoginOtp({ otpId: request.challengeId, rawOtp: otp });

    expect(verify.ok).toBe(true);
    if (verify.ok) {
      expect(verify.stage).toBe("totp_setup_required");
      expect(verify.userId).toBe("user-1");
      expect(verify.totpSecret).toMatch(/^[A-Z2-7]+$/u);
      expect(verify.provisioningUri).toContain("otpauth://totp/");
      expect(verify.provisioningUri).toContain("issuer=ApplyWizz+Dashboard");
      expect(verify.challenge).toMatch(/^loginchallengev1_/u);
    }
  });

  it("returns a login challenge for an already-enabled user's email OTP as a defensive fallback", async () => {
    const { verifyDashboardLoginOtp } = await import("./authFlow");
    const { createDashboardEmailOtp } = await import("./otpStore");

    users[0].totpEnabled = true;
    users[0].totpSecretEncrypted = "encrypted-secret";
    const created = await createDashboardEmailOtp({ userId: "user-1", rawOtp: "123456" });
    if (!created.ok) throw new Error("expected otp creation");
    const verify = await verifyDashboardLoginOtp({ otpId: created.otpId, rawOtp: "123456" });

    expect(verify).toEqual({
      ok: true,
      stage: "totp_required",
      userId: "user-1",
      challenge: expect.stringMatching(/^loginchallengev1_/u),
    });
  });
});

describe("completeDashboardTotpSetup and verifyDashboardLoginTotp", () => {
  it("performs the full TOTP setup and login round trip without logging secrets", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { startDashboardLogin, verifyDashboardLoginOtp, completeDashboardTotpSetup, verifyDashboardLoginTotp } =
      await import("./authFlow");
    const { decryptTotpSecret } = await import("./totp");

    const request = await startDashboardLogin({ email: "admin@applywizz.ai" });
    if (request.nextStep !== "email_otp") throw new Error("expected email OTP stage");
    const rawOtp = sentEmails[0].otp;
    const verification = await verifyDashboardLoginOtp({ otpId: request.challengeId, rawOtp });

    if (!verification.ok) throw new Error("expected TOTP setup stage");
    expect(verification.challenge).toMatch(/^loginchallengev1_/u);

    const totpCode = referenceTotp(verification.totpSecret, TEST_TIME);
    const setup = await completeDashboardTotpSetup({
      challenge: verification.challenge,
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

    const emailsAfterSetup = sentEmails.length;
    const loginStart = await startDashboardLogin({ email: "admin@applywizz.ai" });
    expect(loginStart).toEqual({ ok: true, nextStep: "totp", challenge: expect.stringMatching(/^loginchallengev1_/u) });
    expect(sentEmails).toHaveLength(emailsAfterSetup);
    if (loginStart.nextStep !== "totp") throw new Error("expected TOTP login stage");

    const loginCode = referenceTotp(verification.totpSecret, TEST_TIME);
    const login = await verifyDashboardLoginTotp({ challenge: loginStart.challenge, code: loginCode });
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

  it("returning login preserves totp_enabled and the existing secret and skips email OTP entirely", async () => {
    const { startDashboardLogin, verifyDashboardLoginOtp, completeDashboardTotpSetup, verifyDashboardLoginTotp } =
      await import("./authFlow");

    // 1. First-time registration.
    const setupRequest = await startDashboardLogin({ email: "admin@applywizz.ai" });
    if (setupRequest.nextStep !== "email_otp") throw new Error("expected email OTP stage");
    const setupOtp = sentEmails.at(-1)?.otp ?? "";
    const setupVerify = await verifyDashboardLoginOtp({ otpId: setupRequest.challengeId, rawOtp: setupOtp });
    if (!setupVerify.ok || setupVerify.stage !== "totp_setup_required") throw new Error("expected setup stage");
    const secret = setupVerify.totpSecret;
    const setup = await completeDashboardTotpSetup({ challenge: setupVerify.challenge, code: referenceTotp(secret, TEST_TIME) });
    expect(setup.ok).toBe(true);

    // 2/3. Registration is now persisted: enabled flag on, secret stored once.
    expect(users[0].totpEnabled).toBe(true);
    const storedAfterSetup = users[0].totpSecretEncrypted;
    const setCallsAfterSetup = setTotpSecretCalls;
    const emailsAfterSetup = sentEmails.length;
    expect(storedAfterSetup).toBeTruthy();

    // 4/5. A fresh login for a returning authenticator user skips email OTP entirely.
    const loginStart = await startDashboardLogin({ email: "admin@applywizz.ai" });
    expect(sentEmails.length).toBe(emailsAfterSetup);

    // 6/7. The returning user goes straight to the authenticator-login stage:
    // no new secret, no provisioning URI, no email OTP round trip.
    expect(loginStart).toEqual({
      ok: true,
      nextStep: "totp",
      challenge: expect.stringMatching(/^loginchallengev1_/u),
    });
    if (loginStart.nextStep !== "totp") throw new Error("expected login stage");

    // 8/9. The existing authenticator secret authenticates and mints a session.
    const login = await verifyDashboardLoginTotp({ challenge: loginStart.challenge, code: referenceTotp(secret, TEST_TIME) });
    expect(login.ok).toBe(true);

    // 2/3 preserved: no re-registration occurred during login.
    expect(users[0].totpEnabled).toBe(true);
    expect(setTotpSecretCalls).toBe(setCallsAfterSetup);
    expect(users[0].totpSecretEncrypted).toBe(storedAfterSetup);
  });

  it("rejects invalid setup challenges before DB lookup and before rate-limit checks", async () => {
    const { completeDashboardTotpSetup } = await import("./authFlow");

    await expect(
      completeDashboardTotpSetup({
        challenge: "loginchallengev1_not-valid",
        code: "123456",
        ip: "198.51.100.1",
        userAgent: "setup-test",
      }),
    ).resolves.toEqual({ ok: false });
    expect(userLookupCalls).toBe(0);
    expect(setTotpSecretCalls).toBe(0);
    expect(totpSetupThrottleChecks).toBe(0);
  });

  it("rejects invalid login challenges before DB lookup and before rate-limit checks", async () => {
    const { verifyDashboardLoginTotp } = await import("./authFlow");

    await expect(
      verifyDashboardLoginTotp({
        challenge: "loginchallengev1_not-valid",
        code: "123456",
        ip: "198.51.100.2",
        userAgent: "login-test",
      }),
    ).resolves.toEqual({ ok: false });
    expect(userAuthLookupCalls).toBe(0);
    expect(totpLoginThrottleChecks).toBe(0);
  });

  it("locks out setup after repeated failures and keeps locking out correct codes", async () => {
    const { startDashboardLogin, verifyDashboardLoginOtp, completeDashboardTotpSetup } =
      await import("./authFlow");

    const request = await startDashboardLogin({ email: "admin@applywizz.ai" });
    if (request.nextStep !== "email_otp") throw new Error("expected email OTP stage");
    const otp = sentEmails[0].otp;
    const verification = await verifyDashboardLoginOtp({ otpId: request.challengeId, rawOtp: otp });

    if (!verification.ok) throw new Error("expected TOTP setup stage");
    expect(verification.challenge).toMatch(/^loginchallengev1_/u);

    const wrongCode = "000000";
    for (let i = 0; i < 5; i++) {
      await expect(
        completeDashboardTotpSetup({
          challenge: verification.challenge,
          code: wrongCode,
          ip: "198.51.100.1",
          userAgent: "setup-test",
        }),
      ).resolves.toEqual({ ok: false });
    }

    const correctCode = referenceTotp(verification.totpSecret, TEST_TIME);
    await expect(
      completeDashboardTotpSetup({
        challenge: verification.challenge,
        code: correctCode,
        ip: "198.51.100.1",
        userAgent: "setup-test",
      }),
    ).resolves.toEqual({ ok: false });
  });

  it("locks out TOTP login after repeated failures and keeps locking out correct codes", async () => {
    const { startDashboardLogin, verifyDashboardLoginOtp, completeDashboardTotpSetup, verifyDashboardLoginTotp } =
      await import("./authFlow");

    const request = await startDashboardLogin({ email: "admin@applywizz.ai" });
    if (request.nextStep !== "email_otp") throw new Error("expected email OTP stage");
    const otp = sentEmails[0].otp;
    const verification = await verifyDashboardLoginOtp({ otpId: request.challengeId, rawOtp: otp });

    if (!verification.ok) throw new Error("expected TOTP setup stage");
    expect(verification.challenge).toMatch(/^loginchallengev1_/u);

    const setupCode = referenceTotp(verification.totpSecret, TEST_TIME);
    const setup = await completeDashboardTotpSetup({
      challenge: verification.challenge,
      code: setupCode,
    });
    if (!setup.ok) throw new Error("expected setup session");

    const storedSecret = users[0].totpSecretEncrypted;
    if (!storedSecret) throw new Error("expected stored secret");

    const loginStart = await startDashboardLogin({ email: "admin@applywizz.ai" });
    if (loginStart.nextStep !== "totp") throw new Error("expected TOTP login stage");

    const wrongCode = "000000";
    for (let i = 0; i < 5; i++) {
      await expect(
        verifyDashboardLoginTotp({
          challenge: loginStart.challenge,
          code: wrongCode,
          ip: "198.51.100.2",
          userAgent: "login-test",
        }),
      ).resolves.toEqual({ ok: false });
    }

    const correctCode = referenceTotp(verification.totpSecret, TEST_TIME);
    await expect(
      verifyDashboardLoginTotp({
        challenge: loginStart.challenge,
        code: correctCode,
        ip: "198.51.100.2",
        userAgent: "login-test",
      }),
    ).resolves.toEqual({ ok: false });
  });

  it("fails closed for missing or disabled users and for invalid TOTP state", async () => {
    const { completeDashboardTotpSetup, verifyDashboardLoginTotp } = await import("./authFlow");

    const { issueDashboardLoginChallenge } = await import("./loginChallenge");

    const missingSetupChallenge = issueDashboardLoginChallenge({
      userId: "missing",
      stage: "totp_setup",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });
    const missingLoginChallenge = issueDashboardLoginChallenge({
      userId: "missing",
      stage: "totp_login",
    });

    await expect(
      completeDashboardTotpSetup({ challenge: missingSetupChallenge, code: "123456" }),
    ).resolves.toEqual({ ok: false });
    await expect(verifyDashboardLoginTotp({ challenge: missingLoginChallenge, code: "123456" })).resolves.toEqual({
      ok: false,
    });

    const disabledSetupChallenge = issueDashboardLoginChallenge({
      userId: "user-2",
      stage: "totp_setup",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });
    const disabledLoginChallenge = issueDashboardLoginChallenge({
      userId: "user-2",
      stage: "totp_login",
    });

    await expect(
      completeDashboardTotpSetup({ challenge: disabledSetupChallenge, code: "123456" }),
    ).resolves.toEqual({ ok: false });
    await expect(verifyDashboardLoginTotp({ challenge: disabledLoginChallenge, code: "123456" })).resolves.toEqual({
      ok: false,
    });
  });

  it("rejects forged, tampered, and wrong-stage challenges", async () => {
    const { startDashboardLogin, verifyDashboardLoginOtp, completeDashboardTotpSetup, verifyDashboardLoginTotp } =
      await import("./authFlow");
    const { issueDashboardLoginChallenge } = await import("./loginChallenge");

    const request = await startDashboardLogin({ email: "admin@applywizz.ai" });
    if (request.nextStep !== "email_otp") throw new Error("expected email OTP stage");
    const otp = sentEmails[0].otp;
    const verification = await verifyDashboardLoginOtp({ otpId: request.challengeId, rawOtp: otp });
    if (!verification.ok) throw new Error("expected setup challenge");

    const loginChallenge = issueDashboardLoginChallenge({ userId: verification.userId, stage: "totp_login" });
    const setupChallenge = issueDashboardLoginChallenge({
      userId: verification.userId,
      stage: "totp_setup",
      totpSecret: verification.totpSecret,
    });

    const tamperedSetup = `${setupChallenge.slice(0, -1)}${setupChallenge.endsWith("A") ? "B" : "A"}`;
    const tamperedLogin = `${loginChallenge.slice(0, -1)}${loginChallenge.endsWith("A") ? "B" : "A"}`;

    await expect(completeDashboardTotpSetup({ challenge: tamperedSetup, code: "123456" })).resolves.toEqual({
      ok: false,
    });
    await expect(verifyDashboardLoginTotp({ challenge: tamperedLogin, code: "123456" })).resolves.toEqual({
      ok: false,
    });

    await expect(verifyDashboardLoginTotp({ challenge: setupChallenge, code: "123456" })).resolves.toEqual({
      ok: false,
    });
    await expect(completeDashboardTotpSetup({ challenge: loginChallenge, code: "123456" })).resolves.toEqual({
      ok: false,
    });
  });
});
