import "server-only";

import { createHash, randomUUID } from "crypto";
import { buildTotpProvisioningUri, encryptTotpSecret, generateTotpSecret, verifyTotpCode, decryptTotpSecret } from "@/lib/dashboardAuth/totp";
import {
  createDashboardEmailOtp,
  getLatestUsableDashboardEmailOtp,
  invalidateDashboardEmailOtp,
  verifyDashboardEmailOtp,
} from "@/lib/dashboardAuth/otpStore";
import {
  getDashboardUserAuthRecordById,
  getDashboardUserById,
  getOrCreateDashboardUserForLogin,
  setDashboardUserTotpSecret,
  type DashboardUser,
} from "@/lib/dashboardAuth/users";
import { createDashboardSession } from "@/lib/dashboardAuth/sessionStore";
import { generateRawOtp } from "@/lib/dashboardAuth/otp";
import { generateRawSessionToken } from "@/lib/dashboardAuth/session";
import { recordDashboardAuthAuditEvent } from "@/lib/dashboardAuth/auditEvents";
import { sendDashboardOtpEmail } from "@/lib/dashboardAuth/microsoftGraphOtp";
import {
  isDashboardLoginOtpRequestThrottled,
  isDashboardTotpLoginThrottled,
  isDashboardTotpSetupThrottled,
} from "@/lib/dashboardAuth/rateLimit";
import { issueDashboardLoginChallenge, verifyDashboardLoginChallenge } from "@/lib/dashboardAuth/loginChallenge";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

const DASHBOARD_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

type DashboardAuditEventType =
  | "login_otp_requested"
  | "login_otp_verify"
  | "totp_setup_completed"
  | "login_totp_verify"
  | "account_auto_provisioned";

async function recordAuthEvent(params: {
  userId?: string | null;
  eventType: DashboardAuditEventType;
  success: boolean;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await recordDashboardAuthAuditEvent({
    userId: params.userId ?? null,
    eventType: params.eventType,
    success: params.success,
    ip: params.ip ?? null,
    userAgent: params.userAgent ?? null,
  });
}

function buildSessionExpiry(): Date {
  return new Date(Date.now() + DASHBOARD_SESSION_TTL_MS);
}

interface CronLockDeleteChain extends PromiseLike<{ error: { message: string } | null }> {
  eq(column: string, value: string): CronLockDeleteChain;
  lt(column: string, value: string): CronLockDeleteChain;
}

interface CronLocksLike {
  from(table: "cron_locks"): {
    delete(): CronLockDeleteChain;
    insert(row: { lock_key: string; started_at: string; owner_token: string }): Promise<{
      error: { code?: string; message: string } | null;
    }>;
  };
}

const LOGIN_START_LOCK_PREFIX = "dashboard_login_start:";
const LOGIN_START_LOCK_STALE_MS = 120_000;
const LOGIN_START_LOCK_WAIT_MS = 150;
const LOGIN_START_LOCK_ATTEMPTS = 20;

function normalizeDashboardLoginEmailForLock(email: string): string {
  return email.trim().toLowerCase();
}

function dashboardLoginStartLockKey(normalizedEmail: string): string {
  return `${LOGIN_START_LOCK_PREFIX}${createHash("sha256").update(normalizedEmail).digest("hex")}`;
}

async function acquireDashboardLoginStartLock(
  normalizedEmail: string,
): Promise<{ ok: true; ownerToken: string; lockKey: string } | { ok: false }> {
  const lockKey = dashboardLoginStartLockKey(normalizedEmail);
  const ownerToken = randomUUID();

  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as CronLocksLike;

    for (let attempt = 0; attempt < LOGIN_START_LOCK_ATTEMPTS; attempt++) {
      const staleBefore = new Date(Date.now() - LOGIN_START_LOCK_STALE_MS).toISOString();
      await supabase.from("cron_locks").delete().eq("lock_key", lockKey).lt("started_at", staleBefore);
      const { error } = await supabase.from("cron_locks").insert({
        lock_key: lockKey,
        started_at: new Date().toISOString(),
        owner_token: ownerToken,
      });

      if (!error) return { ok: true, ownerToken, lockKey };
      if (error.code !== "23505") return { ok: false };
      await new Promise((resolve) => setTimeout(resolve, LOGIN_START_LOCK_WAIT_MS));
    }

    return { ok: false };
  } catch {
    return { ok: false };
  }
}

async function releaseDashboardLoginStartLock(lock: { ownerToken: string; lockKey: string }): Promise<void> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as CronLocksLike;
    await supabase.from("cron_locks").delete().eq("lock_key", lock.lockKey).eq("owner_token", lock.ownerToken);
  } catch {
    // Best-effort release: a lock we fail to delete here self-heals via the
    // staleness purge in acquireDashboardLoginStartLock on its next attempt.
  }
}

export type DashboardLoginStartResult =
  | { ok: true; nextStep: "email_otp"; challengeId: string }
  | { ok: true; nextStep: "totp"; challenge: string };

export async function startDashboardLogin(params: {
  email: string;
  ip?: string;
  userAgent?: string;
}): Promise<DashboardLoginStartResult> {
  const normalizedEmail = normalizeDashboardLoginEmailForLock(params.email);
  const fallbackChallengeId = randomUUID();
  const lock = await acquireDashboardLoginStartLock(normalizedEmail);
  if (!lock.ok) {
    await recordAuthEvent({ eventType: "login_otp_requested", success: false, ip: params.ip, userAgent: params.userAgent });
    return { ok: true, nextStep: "email_otp", challengeId: fallbackChallengeId };
  }

  try {
    return await startDashboardLoginUnlocked({ email: params.email, fallbackChallengeId, ip: params.ip, userAgent: params.userAgent });
  } finally {
    await releaseDashboardLoginStartLock(lock);
  }
}

async function startDashboardLoginUnlocked(params: {
  email: string;
  fallbackChallengeId: string;
  ip?: string;
  userAgent?: string;
}): Promise<DashboardLoginStartResult> {
  const result = await getOrCreateDashboardUserForLogin(params.email);
  if (!result || result.user.status !== "active") {
    await recordAuthEvent({
      eventType: "login_otp_requested",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: true, nextStep: "email_otp", challengeId: params.fallbackChallengeId };
  }

  const { user, created } = result;

  if (created) {
    await recordAuthEvent({
      userId: user.id,
      eventType: "account_auto_provisioned",
      success: true,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  }

  if (user.totpEnabled) {
    const challenge = issueDashboardLoginChallenge({ userId: user.id, stage: "totp_login" });
    return { ok: true, nextStep: "totp", challenge };
  }

  return await requestDashboardLoginOtpForUser({ user, fallbackChallengeId: params.fallbackChallengeId, ip: params.ip, userAgent: params.userAgent });
}

async function requestDashboardLoginOtpForUser(params: {
  user: DashboardUser;
  fallbackChallengeId: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ ok: true; nextStep: "email_otp"; challengeId: string }> {
  if (await isDashboardLoginOtpRequestThrottled(params.user.id)) {
    await recordAuthEvent({ userId: params.user.id, eventType: "login_otp_requested", success: false, ip: params.ip, userAgent: params.userAgent });
    return { ok: true, nextStep: "email_otp", challengeId: params.fallbackChallengeId };
  }

  const existingOtp = await getLatestUsableDashboardEmailOtp(params.user.id);
  if (existingOtp.ok) {
    return { ok: true, nextStep: "email_otp", challengeId: existingOtp.challengeId };
  }

  const rawOtp = generateRawOtp();
  const createResult = await createDashboardEmailOtp({ userId: params.user.id, rawOtp });
  let challengeId = params.fallbackChallengeId;
  let success = false;

  if (createResult.ok) {
    challengeId = createResult.otpId;
    const sendResult = await sendDashboardOtpEmail({ to: params.user.email, otp: rawOtp });
    success = sendResult.ok;
    if (!sendResult.ok && sendResult.reason === "explicit_failure") {
      await invalidateDashboardEmailOtp(createResult.otpId);
      challengeId = params.fallbackChallengeId;
    }
  }

  await recordAuthEvent({ userId: params.user.id, eventType: "login_otp_requested", success, ip: params.ip, userAgent: params.userAgent });
  return { ok: true, nextStep: "email_otp", challengeId };
}

export async function verifyDashboardLoginOtp(params: {
  otpId: string;
  rawOtp: string;
  ip?: string;
  userAgent?: string;
}): Promise<
  | {
      ok: true;
      stage: "totp_setup_required";
      userId: string;
      totpSecret: string;
      provisioningUri: string;
      challenge: string;
    }
  | {
      ok: true;
      stage: "totp_required";
      userId: string;
      challenge: string;
    }
  | { ok: false }
> {
  const otpResult = await verifyDashboardEmailOtp({ otpId: params.otpId, rawOtp: params.rawOtp });
  if (!otpResult.ok) {
    await recordAuthEvent({
      eventType: "login_otp_verify",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  const user = await getDashboardUserById(otpResult.userId);
  if (!user || user.status !== "active") {
    await recordAuthEvent({
      userId: otpResult.userId,
      eventType: "login_otp_verify",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  if (!user.totpEnabled) {
    const totpSecret = generateTotpSecret();
    const provisioningUri = buildTotpProvisioningUri({ email: user.email, secret: totpSecret });
    const challenge = issueDashboardLoginChallenge({
      userId: user.id,
      stage: "totp_setup",
      totpSecret,
    });
    await recordAuthEvent({
      userId: user.id,
      eventType: "login_otp_verify",
      success: true,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return {
      ok: true,
      stage: "totp_setup_required",
      userId: user.id,
      totpSecret,
      provisioningUri,
      challenge,
    };
  }

  const challenge = issueDashboardLoginChallenge({
    userId: user.id,
    stage: "totp_login",
  });
  await recordAuthEvent({
    userId: user.id,
    eventType: "login_otp_verify",
    success: true,
    ip: params.ip,
    userAgent: params.userAgent,
  });

  return { ok: true, stage: "totp_required", userId: user.id, challenge };
}

export async function completeDashboardTotpSetup(params: {
  challenge: string;
  code: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ ok: true; sessionToken: string } | { ok: false }> {
  const verifiedChallenge = verifyDashboardLoginChallenge(params.challenge, "totp_setup");
  if (!verifiedChallenge.ok) {
    return { ok: false };
  }

  const user = await getDashboardUserById(verifiedChallenge.userId);
  if (!user || user.status !== "active" || user.totpEnabled) {
    await recordAuthEvent({
      userId: verifiedChallenge.userId,
      eventType: "totp_setup_completed",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  if (await isDashboardTotpSetupThrottled(verifiedChallenge.userId)) {
    await recordAuthEvent({
      userId: verifiedChallenge.userId,
      eventType: "totp_setup_completed",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  const trustedTotpSecret = verifiedChallenge.totpSecret;
  if (!trustedTotpSecret || !verifyTotpCode({ secret: trustedTotpSecret, code: params.code })) {
    await recordAuthEvent({
      userId: verifiedChallenge.userId,
      eventType: "totp_setup_completed",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  const encryptedSecret = encryptTotpSecret(trustedTotpSecret);
  const saved = await setDashboardUserTotpSecret({ userId: verifiedChallenge.userId, encryptedSecret });
  if (!saved.ok) {
    await recordAuthEvent({
      userId: verifiedChallenge.userId,
      eventType: "totp_setup_completed",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  const sessionToken = generateRawSessionToken();
  const sessionResult = await createDashboardSession({
    userId: verifiedChallenge.userId,
    rawToken: sessionToken,
    expiresAt: buildSessionExpiry(),
  });
  if (!sessionResult.ok) {
    await recordAuthEvent({
      userId: verifiedChallenge.userId,
      eventType: "totp_setup_completed",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  await recordAuthEvent({
    userId: verifiedChallenge.userId,
    eventType: "totp_setup_completed",
    success: true,
    ip: params.ip,
    userAgent: params.userAgent,
  });

  return { ok: true, sessionToken };
}

export async function verifyDashboardLoginTotp(params: {
  challenge: string;
  code: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ ok: true; sessionToken: string } | { ok: false }> {
  const verifiedChallenge = verifyDashboardLoginChallenge(params.challenge, "totp_login");
  if (!verifiedChallenge.ok) {
    return { ok: false };
  }

  const user = await getDashboardUserAuthRecordById(verifiedChallenge.userId);
  if (!user || user.status !== "active" || !user.totpEnabled || !user.totpSecretEncrypted) {
    await recordAuthEvent({
      userId: verifiedChallenge.userId,
      eventType: "login_totp_verify",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  if (await isDashboardTotpLoginThrottled(verifiedChallenge.userId)) {
    await recordAuthEvent({
      userId: verifiedChallenge.userId,
      eventType: "login_totp_verify",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  const totpSecret = decryptTotpSecret(user.totpSecretEncrypted);
  if (!totpSecret || !verifyTotpCode({ secret: totpSecret, code: params.code })) {
    await recordAuthEvent({
      userId: verifiedChallenge.userId,
      eventType: "login_totp_verify",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  const sessionToken = generateRawSessionToken();
  const sessionResult = await createDashboardSession({
    userId: verifiedChallenge.userId,
    rawToken: sessionToken,
    expiresAt: buildSessionExpiry(),
  });
  if (!sessionResult.ok) {
    await recordAuthEvent({
      userId: verifiedChallenge.userId,
      eventType: "login_totp_verify",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  await recordAuthEvent({
    userId: verifiedChallenge.userId,
    eventType: "login_totp_verify",
    success: true,
    ip: params.ip,
    userAgent: params.userAgent,
  });

  return { ok: true, sessionToken };
}
