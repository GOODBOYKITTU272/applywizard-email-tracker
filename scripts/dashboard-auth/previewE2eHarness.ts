import { createHmac } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  disablePreviewAdmin,
  normalizePreviewAdminEmail,
  resolveSupabaseProjectRef,
  type PreviewAdminSupabase,
} from "./previewAdminTool";

export type PreviewE2eGuardCode =
  | "INVALID_TARGET"
  | "MISSING_PREVIEW_URL"
  | "MALFORMED_PREVIEW_URL"
  | "PRODUCTION_URL"
  | "MISSING_EMAIL"
  | "MISSING_PROJECT_REF"
  | "MALFORMED_PROJECT_REF"
  | "MISSING_SUPABASE_URL"
  | "MALFORMED_SUPABASE_URL"
  | "PROJECT_REF_MISMATCH"
  | "MISSING_SERVICE_ROLE_KEY"
  | "MISSING_BASIC_AUTH_SECRET";

export type PreviewE2eGuardResult =
  | {
      ok: true;
      config: {
        previewUrl: string;
        normalizedEmail: string;
        projectRef: string;
        basicAuthSecret: string;
      };
    }
  | { ok: false; code: PreviewE2eGuardCode };

type SessionLookup =
  | {
      ok: true;
      session: {
        id: string;
      };
    }
  | { ok: false };

interface SessionMutationSupabase {
  from(table: string): {
    update(row: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const PRODUCTION_HOSTS = new Set(["email-apply-wizz.vercel.app"]);

function isProductionPreviewUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return PRODUCTION_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export function validatePreviewE2eEnvironment(env: NodeJS.ProcessEnv): PreviewE2eGuardResult {
  if (env.DASHBOARD_AUTH_E2E_TARGET !== "preview") return { ok: false, code: "INVALID_TARGET" };

  const previewUrl = env.DASHBOARD_PREVIEW_URL?.trim() ?? "";
  if (!previewUrl) return { ok: false, code: "MISSING_PREVIEW_URL" };
  try {
    new URL(previewUrl);
  } catch {
    return { ok: false, code: "MALFORMED_PREVIEW_URL" };
  }
  if (isProductionPreviewUrl(previewUrl)) return { ok: false, code: "PRODUCTION_URL" };

  const normalizedEmail = normalizePreviewAdminEmail(env.DASHBOARD_TEST_ADMIN_EMAIL ?? "");
  if (!normalizedEmail) return { ok: false, code: "MISSING_EMAIL" };

  const projectRef = env.DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF?.trim() ?? "";
  if (!projectRef) return { ok: false, code: "MISSING_PROJECT_REF" };
  if (!PROJECT_REF_PATTERN.test(projectRef)) return { ok: false, code: "MALFORMED_PROJECT_REF" };

  if (!env.NEXT_PUBLIC_SUPABASE_URL?.trim()) return { ok: false, code: "MISSING_SUPABASE_URL" };
  const resolvedRef = resolveSupabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!resolvedRef) return { ok: false, code: "MALFORMED_SUPABASE_URL" };
  if (resolvedRef !== projectRef) return { ok: false, code: "PROJECT_REF_MISMATCH" };

  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return { ok: false, code: "MISSING_SERVICE_ROLE_KEY" };

  const basicAuthSecret = env.DASHBOARD_SECRET?.trim() ?? "";
  if (!basicAuthSecret) return { ok: false, code: "MISSING_BASIC_AUTH_SECRET" };

  return {
    ok: true,
    config: {
      previewUrl,
      normalizedEmail,
      projectRef,
      basicAuthSecret,
    },
  };
}

function base32Decode(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const rawChar of secret.replace(/=+$/g, "").toUpperCase()) {
    const value = alphabet.indexOf(rawChar);
    if (value < 0) throw new Error("Invalid base32 secret.");
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpCodeForPreview(secret: string, now = new Date()): string {
  const key = base32Decode(secret);
  const counter = Math.floor(now.getTime() / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0);

  const digest = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

async function promptForOtp(prompt: string): Promise<string> {
  const reader = createInterface({ input, output });
  try {
    return (await reader.question(prompt)).trim();
  } finally {
    reader.close();
  }
}

async function expireCurrentSession(params: {
  rawToken: string;
  getSession: (rawToken: string) => Promise<SessionLookup>;
  supabase: SessionMutationSupabase;
}): Promise<boolean> {
  const session = await params.getSession(params.rawToken);
  if (!session.ok) return false;

  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  const result = await params.supabase
    .from("dashboard_sessions")
    .update({ expires_at: expiredAt })
    .eq("id", session.session.id);

  return !result.error;
}

export async function runPreviewDashboardAuthE2E(env: NodeJS.ProcessEnv = process.env): Promise<{ ok: true } | { ok: false; code: string }> {
  const guard = validatePreviewE2eEnvironment(env);
  if (!guard.ok) return guard;

  const { chromium } = await import("@playwright/test");
  const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/serviceRole");
  const { getDashboardSessionByToken, revokeDashboardSessionsForUser } = await import("@/lib/dashboardAuth/sessionStore");

  const supabase = createSupabaseServiceRoleClient() as unknown as PreviewAdminSupabase & SessionMutationSupabase;
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    httpCredentials: {
      username: "admin",
      password: guard.config.basicAuthSecret,
    },
  });
  const page = await context.newPage();
  let cleanupOk = false;

  try {
    const unauthenticated = await fetch(new URL("/dashboard/login", guard.config.previewUrl), { redirect: "manual" });
    if (unauthenticated.status !== 401) return { ok: false, code: "BASIC_AUTH_GATE_NOT_CONFIRMED" };

    await page.goto(new URL("/dashboard/login", guard.config.previewUrl).toString());
    await page.getByTestId("dashboard-auth-email").fill(guard.config.normalizedEmail);
    await page.getByRole("button", { name: "Send OTP" }).click();

    const otp = await promptForOtp("Enter the email OTP shown in the dedicated Preview test mailbox: ");
    await page.getByTestId("dashboard-auth-otp").fill(otp);
    await page.getByRole("button", { name: "Continue" }).click();

    const setupSecret = page.getByTestId("dashboard-auth-totp-secret");
    if (await setupSecret.isVisible().catch(() => false)) {
      const secret = (await setupSecret.textContent())?.trim() ?? "";
      const code = generateTotpCodeForPreview(secret);
      await page.getByTestId("dashboard-auth-setup-code").fill(code);
      await page.getByRole("button", { name: "Complete setup" }).click();
    } else {
      const code = await promptForOtp("Enter the authenticator code for the Preview test user: ");
      await page.getByTestId("dashboard-auth-login-code").fill(code);
      await page.getByRole("button", { name: "Sign in" }).click();
    }

    await page.waitForURL("**/overview");
    await page.goto(new URL("/dashboard", guard.config.previewUrl).toString());
    await page.getByText("Email Tracker Dashboard").first().waitFor();
    await page.goto(new URL("/applications", guard.config.previewUrl).toString());

    const cookies = await context.cookies(guard.config.previewUrl);
    const sessionCookie = cookies.find((cookie) => cookie.name === "dashboard_session");
    if (!sessionCookie?.value) return { ok: false, code: "MISSING_SESSION_COOKIE" };

    const expired = await expireCurrentSession({
      rawToken: sessionCookie.value,
      getSession: getDashboardSessionByToken,
      supabase,
    });
    if (!expired) return { ok: false, code: "SESSION_EXPIRY_FAILED" };

    await page.getByRole("link", { name: "Mailboxes" }).click();
    await page.waitForURL("**/dashboard/login");

    await page.goto(new URL("/dashboard/login", guard.config.previewUrl).toString());
    await page.getByTestId("dashboard-auth-email").fill(guard.config.normalizedEmail);
    await page.getByRole("button", { name: "Send OTP" }).click();
    const secondOtp = await promptForOtp("Enter the second email OTP shown in the dedicated Preview test mailbox: ");
    await page.getByTestId("dashboard-auth-otp").fill(secondOtp);
    await page.getByRole("button", { name: "Continue" }).click();
    const loginCode = await promptForOtp("Enter the authenticator code for logout verification: ");
    await page.getByTestId("dashboard-auth-login-code").fill(loginCode);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/overview");

    const logoutOk = await page.evaluate(async () => {
      const response = await fetch("/api/dashboard/auth/logout", { method: "POST" });
      return response.ok;
    });
    if (!logoutOk) return { ok: false, code: "LOGOUT_FAILED" };

    await page.goto(new URL("/overview", guard.config.previewUrl).toString());
    await page.waitForURL("**/dashboard/login");

    const cleanup = await disablePreviewAdmin({
      env,
      supabase,
      revokeAllSessionsForUser: revokeDashboardSessionsForUser,
    });
    cleanupOk = cleanup.ok;
    if (!cleanup.ok) return { ok: false, code: "CLEANUP_FAILED" };

    return { ok: true };
  } finally {
    if (!cleanupOk) {
      await disablePreviewAdmin({
        env,
        supabase,
        revokeAllSessionsForUser: revokeDashboardSessionsForUser,
      }).catch(() => undefined);
    }
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
