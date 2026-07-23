import { createHmac } from "node:crypto";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import {
  disablePreviewAdmin,
  normalizePreviewAdminEmail,
  resolveSupabaseProjectRef,
  revokePreviewAdminSessionsForEmail,
  type PreviewAdminSupabase,
} from "./previewAdminTool";

export type PreviewE2eGuardCode =
  | "INVALID_TARGET"
  | "INVALID_SEED_TARGET"
  | "MISSING_PREVIEW_URL"
  | "MALFORMED_PREVIEW_URL"
  | "PRODUCTION_URL"
  | "MISSING_EMAIL"
  | "MISSING_PROJECT_REF"
  | "MALFORMED_PROJECT_REF"
  | "MISSING_PRODUCTION_PROJECT_REF"
  | "MALFORMED_PRODUCTION_PROJECT_REF"
  | "MISSING_SUPABASE_URL"
  | "MALFORMED_SUPABASE_URL"
  | "PROJECT_REF_MISMATCH"
  | "PRODUCTION_PROJECT_REF"
  | "MISSING_SERVICE_ROLE_KEY";

export type PreviewE2eGuardResult =
  | {
      ok: true;
      config: {
        previewUrl: string;
        normalizedEmail: string;
        projectRef: string;
        productionProjectRef: string;
      };
    }
  | { ok: false; code: PreviewE2eGuardCode };

type PreviewBrowser = {
  newContext(): Promise<PreviewBrowserContext>;
  close(): Promise<void>;
};

type PreviewBrowserContext = {
  newPage(): Promise<PreviewPage>;
  close(): Promise<void>;
  setDefaultTimeout(timeout: number): void;
  setDefaultNavigationTimeout(timeout: number): void;
};

type PreviewLocator = {
  fill(value: string): Promise<void>;
  click(): Promise<void>;
  isVisible(): Promise<boolean>;
  textContent(): Promise<string | null>;
  waitFor(): Promise<void>;
};

type PreviewPage = {
  goto(url: string): Promise<unknown>;
  getByTestId(testId: string): PreviewLocator;
  getByRole(role: string, options: { name: string }): PreviewLocator;
  getByText(text: string): { first(): PreviewLocator };
  waitForURL(url: string): Promise<void>;
  evaluate<T>(callback: () => Promise<T>): Promise<T>;
};

export interface PreviewE2eHarnessDeps {
  launchBrowser?: () => Promise<PreviewBrowser>;
  createSupabase?: () => PreviewAdminSupabase;
  promptForOtp?: (prompt: string) => Promise<string>;
  revokeSessionsForEmail?: (params: { env: NodeJS.ProcessEnv; supabase: PreviewAdminSupabase }) => Promise<{ ok: boolean }>;
  disableAdmin?: (params: { env: NodeJS.ProcessEnv; supabase: PreviewAdminSupabase }) => Promise<{ ok: boolean }>;
  otpInputTimeoutMs?: number;
}

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
// Bounded waits so a missing field, stalled page, or unanswered operator prompt
// throws and reaches cleanup instead of hanging the run indefinitely.
export const PREVIEW_E2E_ACTION_TIMEOUT_MS = 30_000;
export const PREVIEW_E2E_NAVIGATION_TIMEOUT_MS = 30_000;
export const PREVIEW_E2E_OTP_INPUT_TIMEOUT_MS = 10 * 60_000;

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const PRODUCTION_HOSTS = new Set(["email-apply-wizz.vercel.app"]);
export const PREVIEW_E2E_SOFT_NAV_LINK = "Clients";

function isProductionPreviewUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return PRODUCTION_HOSTS.has(hostname) || hostname.includes("email-apply-wizz.vercel.app");
  } catch {
    return false;
  }
}

export function validatePreviewE2eEnvironment(env: NodeJS.ProcessEnv): PreviewE2eGuardResult {
  if (env.DASHBOARD_AUTH_E2E_TARGET !== "preview") return { ok: false, code: "INVALID_TARGET" };
  if (env.DASHBOARD_AUTH_SEED_TARGET !== "preview") return { ok: false, code: "INVALID_SEED_TARGET" };

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

  const productionProjectRef = env.DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF?.trim() ?? "";
  if (!productionProjectRef) return { ok: false, code: "MISSING_PRODUCTION_PROJECT_REF" };
  if (!PROJECT_REF_PATTERN.test(productionProjectRef)) {
    return { ok: false, code: "MALFORMED_PRODUCTION_PROJECT_REF" };
  }
  if (productionProjectRef === projectRef) return { ok: false, code: "PRODUCTION_PROJECT_REF" };

  if (!env.NEXT_PUBLIC_SUPABASE_URL?.trim()) return { ok: false, code: "MISSING_SUPABASE_URL" };
  const resolvedRef = resolveSupabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!resolvedRef) return { ok: false, code: "MALFORMED_SUPABASE_URL" };
  if (resolvedRef === productionProjectRef) return { ok: false, code: "PRODUCTION_PROJECT_REF" };
  if (resolvedRef !== projectRef) return { ok: false, code: "PROJECT_REF_MISMATCH" };

  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return { ok: false, code: "MISSING_SERVICE_ROLE_KEY" };

  return {
    ok: true,
    config: {
      previewUrl,
      normalizedEmail,
      projectRef,
      productionProjectRef,
    },
  };
}

function originUrl(path: string, baseUrl: string): string {
  return new URL(path, baseUrl).toString();
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

export async function promptForOtpWithTimeout(
  prompt: string,
  timeoutMs: number,
  io: { input?: Readable; output?: Writable } = {},
): Promise<string> {
  // Owns its own cancellation: on timeout the pending question is aborted, the
  // timer cleared, and the interface closed exactly once, so no stdin listener,
  // timer, or readline handle survives to hang the CLI.
  const reader = createInterface({ input: io.input ?? input, output: io.output ?? output });
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const answer = await reader.question(prompt, { signal: controller.signal });
    return answer.trim();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("OTP_INPUT_TIMEOUT");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    reader.close();
  }
}

async function defaultLaunchBrowser(): Promise<PreviewBrowser> {
  const { chromium } = await import("@playwright/test");
  return chromium.launch({ headless: false }) as Promise<PreviewBrowser>;
}

async function defaultCreateSupabase(): Promise<PreviewAdminSupabase> {
  const { createSupabaseServiceRoleClient } = await import("@/lib/supabase/serviceRole");
  return createSupabaseServiceRoleClient() as unknown as PreviewAdminSupabase;
}

export const PREVIEW_E2E_SETUP_CONTROL_TEST_ID = "dashboard-auth-show-setup-key";
export const PREVIEW_E2E_LOGIN_CONTROL_TEST_ID = "dashboard-auth-login-code";

/**
 * Decide the post-OTP branch by waiting (bounded by the context default
 * timeout) for whichever control actually renders first, instead of a one-shot
 * isVisible() check made before the screen has painted. Errors carry no secrets.
 */
export async function detectPostOtpBranch(page: PreviewPage): Promise<"setup" | "login"> {
  const setupControl = page.getByTestId(PREVIEW_E2E_SETUP_CONTROL_TEST_ID);
  const loginControl = page.getByTestId(PREVIEW_E2E_LOGIN_CONTROL_TEST_ID);

  // Promise.race attaches a reaction to both waits, so the loser rejecting later
  // (e.g. at its own timeout) is consumed and never becomes an unhandled rejection.
  const winner = await Promise.race([
    setupControl.waitFor().then(() => "setup" as const),
    loginControl.waitFor().then(() => "login" as const),
  ]).catch(() => null);

  if (!winner) throw new Error("BRANCH_DETECTION_FAILED");

  // Reject an ambiguous dual-state deterministically rather than guessing.
  const otherVisible =
    winner === "setup"
      ? await loginControl.isVisible().catch(() => false)
      : await setupControl.isVisible().catch(() => false);
  if (otherVisible) throw new Error("BRANCH_DETECTION_AMBIGUOUS");

  return winner;
}

async function authenticatePreviewSession(params: {
  page: PreviewPage;
  previewUrl: string;
  email: string;
  promptForOtp: (prompt: string) => Promise<string>;
}): Promise<void> {
  // "/" is the canonical login URL (dashboard/login is now just a redirect
  // stub to it).
  await params.page.goto(originUrl("/", params.previewUrl));
  await params.page.getByTestId("dashboard-auth-email").fill(params.email);
  await params.page.getByRole("button", { name: "Send OTP" }).click();

  const otp = await params.promptForOtp("Enter the email OTP shown in the dedicated Preview test mailbox: ");
  await params.page.getByTestId("dashboard-auth-otp").fill(otp);
  await params.page.getByRole("button", { name: "Continue" }).click();

  // The setup key is hidden behind a QR code; the reveal control's presence marks
  // first-time setup, the login-code input marks an existing authenticator.
  const branch = await detectPostOtpBranch(params.page);
  if (branch === "setup") {
    await params.page.getByTestId(PREVIEW_E2E_SETUP_CONTROL_TEST_ID).click();
    const setupSecret = params.page.getByTestId("dashboard-auth-totp-secret");
    await setupSecret.waitFor();
    const secret = (await setupSecret.textContent())?.trim() ?? "";
    const code = generateTotpCodeForPreview(secret);
    await params.page.getByTestId("dashboard-auth-setup-code").fill(code);
    await params.page.getByRole("button", { name: "Complete setup" }).click();
  } else {
    const code = await params.promptForOtp("Enter the authenticator code for the Preview test user: ");
    await params.page.getByTestId(PREVIEW_E2E_LOGIN_CONTROL_TEST_ID).fill(code);
    await params.page.getByRole("button", { name: "Sign in" }).click();
  }

  await params.page.waitForURL(originUrl("/overview", params.previewUrl));
}

export async function runPreviewDashboardAuthE2EWithDeps(
  env: NodeJS.ProcessEnv = process.env,
  deps: PreviewE2eHarnessDeps = {},
): Promise<{ ok: true } | { ok: false; code: string }> {
  const guard = validatePreviewE2eEnvironment(env);
  if (!guard.ok) return guard;

  // Cleanup dependencies are established before any browser resource exists so
  // mandatory cleanup can still run if browser launch or setup itself throws.
  const supabase = deps.createSupabase ? deps.createSupabase() : await defaultCreateSupabase();
  const revokeSessionsForEmail =
    deps.revokeSessionsForEmail ??
    ((params: { env: NodeJS.ProcessEnv; supabase: PreviewAdminSupabase }) => revokePreviewAdminSessionsForEmail(params));
  const disableAdmin =
    deps.disableAdmin ??
    ((params: { env: NodeJS.ProcessEnv; supabase: PreviewAdminSupabase }) => disablePreviewAdmin(params));
  const otpInputTimeoutMs = deps.otpInputTimeoutMs ?? PREVIEW_E2E_OTP_INPUT_TIMEOUT_MS;
  const rawPromptForOtp = deps.promptForOtp ?? ((prompt: string) => promptForOtpWithTimeout(prompt, otpInputTimeoutMs));
  const promptForOtp = (prompt: string) => withTimeout(rawPromptForOtp(prompt), otpInputTimeoutMs, "OTP_INPUT_TIMEOUT");

  let browser: PreviewBrowser | null = null;
  let context: PreviewBrowserContext | null = null;
  let cleanupOk = false;

  try {
    browser = await (deps.launchBrowser ?? defaultLaunchBrowser)();
    context = await browser.newContext();
    context.setDefaultTimeout(PREVIEW_E2E_ACTION_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(PREVIEW_E2E_NAVIGATION_TIMEOUT_MS);
    const page = await context.newPage();

    await authenticatePreviewSession({
      page,
      previewUrl: guard.config.previewUrl,
      email: guard.config.normalizedEmail,
      promptForOtp,
    });

    await page.goto(originUrl("/dashboard", guard.config.previewUrl));
    await page.getByText("Email Tracker Dashboard").first().waitFor();
    await page.goto(originUrl("/applications", guard.config.previewUrl));

    const revoked = await revokeSessionsForEmail({ env, supabase });
    if (!revoked.ok) return { ok: false, code: "SESSION_REVOKE_FAILED" };

    await page.getByRole("link", { name: PREVIEW_E2E_SOFT_NAV_LINK }).click();
    // The revoked session makes requireDashboardSession() fail closed to
    // "/?expired=1" on the guarded "Clients" route, not the old dedicated
    // /dashboard/login screen.
    await page.waitForURL(originUrl("/?expired=1", guard.config.previewUrl));

    await authenticatePreviewSession({
      page,
      previewUrl: guard.config.previewUrl,
      email: guard.config.normalizedEmail,
      promptForOtp,
    });

    const logoutOk = await page.evaluate(async () => {
      const response = await fetch("/api/dashboard/auth/logout", { method: "POST" });
      return response.ok;
    });
    if (!logoutOk) return { ok: false, code: "LOGOUT_FAILED" };

    await page.goto(originUrl("/overview", guard.config.previewUrl));
    // Logged out, so requireDashboardSession() on the guarded "/overview" route
    // fails closed to "/?expired=1", not the old dedicated /dashboard/login
    // screen.
    await page.waitForURL(originUrl("/?expired=1", guard.config.previewUrl));

    const cleanup = await disableAdmin({ env, supabase });
    cleanupOk = cleanup.ok;
    if (!cleanup.ok) return { ok: false, code: "CLEANUP_FAILED" };

    return { ok: true };
  } finally {
    // Independent, best-effort steps in a fixed order: admin cleanup first, then
    // context, then browser. A failure in one must not skip the others, and the
    // run still fails if required admin cleanup did not ultimately succeed.
    if (!cleanupOk) {
      const cleanup = await disableAdmin({ env, supabase }).catch(() => ({ ok: false }));
      cleanupOk = cleanup.ok;
    }
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

export function runPreviewDashboardAuthE2E(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true } | { ok: false; code: string }> {
  return runPreviewDashboardAuthE2EWithDeps(env);
}
