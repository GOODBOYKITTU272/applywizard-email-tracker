import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { getDashboardLoginChallengeSecret } from "@/lib/dashboardAuth/config";

export const LOGIN_CHALLENGE_SETUP_TTL_MS = 10 * 60 * 1000;
export const LOGIN_CHALLENGE_LOGIN_TTL_MS = 5 * 60 * 1000;

type DashboardLoginChallengeStage = "totp_setup" | "totp_login";

type DashboardLoginChallengePayload = {
  userId: string;
  stage: DashboardLoginChallengeStage;
  totpSecret?: string;
  expiresAt: number;
};

const LOGIN_CHALLENGE_PREFIX = "loginchallengev1_";

function deriveKey(): Buffer {
  return createHash("sha256").update(getDashboardLoginChallengeSecret(), "utf8").digest();
}

function assertValidUserId(userId: string): void {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("Invalid dashboard login challenge payload.");
  }
}

function assertValidStage(stage: string): asserts stage is DashboardLoginChallengeStage {
  if (stage !== "totp_setup" && stage !== "totp_login") {
    throw new Error("Invalid dashboard login challenge payload.");
  }
}

function encodePayload(payload: DashboardLoginChallengePayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${LOGIN_CHALLENGE_PREFIX}${Buffer.concat([iv, authTag, ciphertext]).toString("base64url")}`;
}

function decodePayload(token: string): DashboardLoginChallengePayload | null {
  if (!token || !token.startsWith(LOGIN_CHALLENGE_PREFIX)) return null;

  try {
    const payload = Buffer.from(token.slice(LOGIN_CHALLENGE_PREFIX.length), "base64url");
    if (payload.length <= 28) return null;

    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(), iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext) as DashboardLoginChallengePayload;
  } catch {
    return null;
  }
}

function validatePayload(
  payload: unknown,
  expectedStage: DashboardLoginChallengeStage,
): { ok: true; userId: string; totpSecret?: string } | { ok: false } {
  if (typeof payload !== "object" || payload === null) return { ok: false };

  const record = payload as Partial<DashboardLoginChallengePayload> & Record<string, unknown>;
  if (typeof record.userId !== "string" || !record.userId.trim()) return { ok: false };
  if (typeof record.stage !== "string") return { ok: false };
  try {
    assertValidStage(record.stage);
  } catch {
    return { ok: false };
  }
  if (record.stage !== expectedStage) return { ok: false };
  if (typeof record.expiresAt !== "number" || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) {
    return { ok: false };
  }

  if (record.stage === "totp_setup") {
    if (typeof record.totpSecret !== "string" || !record.totpSecret.trim()) return { ok: false };
    return { ok: true, userId: record.userId, totpSecret: record.totpSecret };
  }

  if ("totpSecret" in record) return { ok: false };
  return { ok: true, userId: record.userId };
}

export function issueDashboardLoginChallenge(params: {
  userId: string;
  stage: DashboardLoginChallengeStage;
  totpSecret?: string;
}): string {
  try {
    assertValidUserId(params.userId);
    assertValidStage(params.stage);

    if (params.stage === "totp_setup") {
      if (typeof params.totpSecret !== "string" || !params.totpSecret.trim()) {
        throw new Error("Invalid dashboard login challenge payload.");
      }
    } else if (params.totpSecret !== undefined) {
      throw new Error("Invalid dashboard login challenge payload.");
    }

    const expiresAt =
      params.stage === "totp_setup"
        ? Date.now() + LOGIN_CHALLENGE_SETUP_TTL_MS
        : Date.now() + LOGIN_CHALLENGE_LOGIN_TTL_MS;

    const payload: DashboardLoginChallengePayload =
      params.stage === "totp_setup"
        ? {
            userId: params.userId,
            stage: params.stage,
            totpSecret: params.totpSecret,
            expiresAt,
          }
        : {
            userId: params.userId,
            stage: params.stage,
            expiresAt,
          };

    return encodePayload(payload);
  } catch {
    throw new Error("Failed to issue dashboard login challenge.");
  }
}

export function verifyDashboardLoginChallenge(
  token: string,
  expectedStage: DashboardLoginChallengeStage,
): { ok: true; userId: string; totpSecret?: string } | { ok: false } {
  try {
    const payload = decodePayload(token);
    if (!payload) return { ok: false };
    return validatePayload(payload, expectedStage);
  } catch {
    return { ok: false };
  }
}
