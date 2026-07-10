import "server-only";

import { randomUUID } from "crypto";
import { buildTotpProvisioningUri, encryptTotpSecret, generateTotpSecret, verifyTotpCode, decryptTotpSecret } from "@/lib/dashboardAuth/totp";
import { createDashboardEmailOtp, verifyDashboardEmailOtp } from "@/lib/dashboardAuth/otpStore";
import { getDashboardUserAuthRecordById, getDashboardUserByEmail, getDashboardUserById, setDashboardUserTotpSecret } from "@/lib/dashboardAuth/users";
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

const DASHBOARD_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

type DashboardAuditEventType =
  | "login_otp_requested"
  | "login_otp_verify"
  | "totp_setup_completed"
  | "login_totp_verify";

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

export async function requestDashboardLoginOtp(params: {
  email: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ ok: true; otpId: string }> {
  const fallbackOtpId = randomUUID();
  const user = await getDashboardUserByEmail(params.email);

  if (!user || user.status !== "active") {
    await recordAuthEvent({
      eventType: "login_otp_requested",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: true, otpId: fallbackOtpId };
  }

  if (await isDashboardLoginOtpRequestThrottled(user.id)) {
    await recordAuthEvent({
      userId: user.id,
      eventType: "login_otp_requested",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: true, otpId: fallbackOtpId };
  }

  const rawOtp = generateRawOtp();
  const createResult = await createDashboardEmailOtp({ userId: user.id, rawOtp });
  let otpId: string = fallbackOtpId;
  let success = false;

  if (createResult.ok) {
    otpId = createResult.otpId;
    const sendResult = await sendDashboardOtpEmail({ to: user.email, otp: rawOtp });
    success = sendResult.ok;
  }

  await recordAuthEvent({
    userId: user.id,
    eventType: "login_otp_requested",
    success,
    ip: params.ip,
    userAgent: params.userAgent,
  });

  return { ok: true, otpId };
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
    }
  | {
      ok: true;
      stage: "totp_required";
      userId: string;
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
    };
  }

  await recordAuthEvent({
    userId: user.id,
    eventType: "login_otp_verify",
    success: true,
    ip: params.ip,
    userAgent: params.userAgent,
  });

  return { ok: true, stage: "totp_required", userId: user.id };
}

export async function completeDashboardTotpSetup(params: {
  userId: string;
  totpSecret: string;
  code: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ ok: true; sessionToken: string } | { ok: false }> {
  const user = await getDashboardUserById(params.userId);
  if (!user || user.status !== "active" || user.totpEnabled) {
    await recordAuthEvent({
      userId: params.userId,
      eventType: "totp_setup_completed",
      success: false,
    });
    return { ok: false };
  }

  if (await isDashboardTotpSetupThrottled(params.userId)) {
    await recordAuthEvent({
      userId: params.userId,
      eventType: "totp_setup_completed",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  if (!verifyTotpCode({ secret: params.totpSecret, code: params.code })) {
    await recordAuthEvent({
      userId: params.userId,
      eventType: "totp_setup_completed",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  const encryptedSecret = encryptTotpSecret(params.totpSecret);
  const saved = await setDashboardUserTotpSecret({ userId: params.userId, encryptedSecret });
  if (!saved.ok) {
    await recordAuthEvent({
      userId: params.userId,
      eventType: "totp_setup_completed",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  const sessionToken = generateRawSessionToken();
  const sessionResult = await createDashboardSession({
    userId: params.userId,
    rawToken: sessionToken,
    expiresAt: buildSessionExpiry(),
  });
  if (!sessionResult.ok) {
    await recordAuthEvent({
      userId: params.userId,
      eventType: "totp_setup_completed",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  await recordAuthEvent({
    userId: params.userId,
    eventType: "totp_setup_completed",
    success: true,
    ip: params.ip,
    userAgent: params.userAgent,
  });

  return { ok: true, sessionToken };
}

export async function verifyDashboardLoginTotp(params: {
  userId: string;
  code: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ ok: true; sessionToken: string } | { ok: false }> {
  const user = await getDashboardUserAuthRecordById(params.userId);
  if (!user || user.status !== "active" || !user.totpEnabled || !user.totpSecretEncrypted) {
    await recordAuthEvent({
      userId: params.userId,
      eventType: "login_totp_verify",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  if (await isDashboardTotpLoginThrottled(params.userId)) {
    await recordAuthEvent({
      userId: params.userId,
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
      userId: params.userId,
      eventType: "login_totp_verify",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  const sessionToken = generateRawSessionToken();
  const sessionResult = await createDashboardSession({
    userId: params.userId,
    rawToken: sessionToken,
    expiresAt: buildSessionExpiry(),
  });
  if (!sessionResult.ok) {
    await recordAuthEvent({
      userId: params.userId,
      eventType: "login_totp_verify",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: false };
  }

  await recordAuthEvent({
    userId: params.userId,
    eventType: "login_totp_verify",
    success: true,
    ip: params.ip,
    userAgent: params.userAgent,
  });

  return { ok: true, sessionToken };
}
