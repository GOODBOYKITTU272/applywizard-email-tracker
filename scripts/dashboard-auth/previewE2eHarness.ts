import { createHmac } from "node:crypto";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

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
  | "MISSING_SERVICE_ROLE_KEY"
  | "MISSING_BASIC_AUTH_SECRET";

export type PreviewE2eGuardResult =
  | {
      ok: true;
      config: {
        previewUrl: string;
        normalizedEmail: string;
        projectRef: string;
        productionProjectRef: string;
        basicAuthSecret: string;
      };
    }
  | { ok: false; code: PreviewE2eGuardCode };

type PreviewBrowser = {
  newContext(options: { httpCredentials: { username: string; password: string } }): Promise<PreviewBrowserContext>;
  close(): Promise<void>;
};

type PreviewBrowserContext = {
  newPage(): Promise<PreviewPage>;
  close(): Promise<void>;
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
  fetch?: typeof fetch;
  revokeSessionsForEmail?: (params: { env: NodeJS.ProcessEnv; supabase: PreviewAdminSupabase }) => Promise<{ ok: boolean }>;
  disableAdmin?: (params: { env: NodeJS.ProcessEnv; supabase: PreviewAdminSupabase }) => Promise<{ ok: boolean }>;
}

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
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

  const basicAuthSecret = env.DASHBOARD_SECRET?.trim() ?? "";
  if (!basicAuthSecret) return { ok: false, code: "MISSING_BASIC_AUTH_SECRET" };

  return {
    ok: true,
    config: {
      previewUrl,
      normalizedEmail,
      projectRef,
      productionProjectRef,
      basicAuthSecret,
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

async function defaultPromptForOtp(prompt: string): Promise<string> {
  const reader = createInterface({ input, output });
  try {
    return (await reader.question(prompt)).trim();
  } finally {
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

async function confirmBasicAuthGate(params: {
  fetchImpl: typeof fetch;
  previewUrl: string;
}): Promise<boolean> {
  const unauthenticated = await params.fetchImpl(originUrl("/dashboard/login", params.previewUrl), { redirect: "manual" });
  return unauthenticated.status === 401;
}

async function authenticatePreviewSession(params: {
  page: PreviewPage;
  previewUrl: string;
  email: string;
  promptForOtp: (prompt: string) => Promise<string>;
}): Promise<void> {
  await params.page.goto(originUrl("/dashboard/login", params.previewUrl));
  await params.page.getByTestId("dashboard-auth-email").fill(params.email);
  await params.page.getByRole("button", { name: "Send OTP" }).click();

  const otp = await params.promptForOtp("Enter the email OTP shown in the dedicated Preview test mailbox: ");
  await params.page.getByTestId("dashboard-auth-otp").fill(otp);
  await params.page.getByRole("button", { name: "Continue" }).click();

  // The setup key is hidden by default behind a QR code; reveal it to read the
  // secret. Presence of the reveal control distinguishes first-time setup from
  // an existing-authenticator login.
  const revealSetupKey = params.page.getByRole("button", { name: "Can't scan? Show setup key" });
  if (await revealSetupKey.isVisible().catch(() => false)) {
    await revealSetupKey.click();
    const setupSecret = params.page.getByTestId("dashboard-auth-totp-secret");
    await setupSecret.waitFor();
    const secret = (await setupSecret.textContent())?.trim() ?? "";
    const code = generateTotpCodeForPreview(secret);
    await params.page.getByTestId("dashboard-auth-setup-code").fill(code);
    await params.page.getByRole("button", { name: "Complete setup" }).click();
  } else {
    const code = await params.promptForOtp("Enter the authenticator code for the Preview test user: ");
    await params.page.getByTestId("dashboard-auth-login-code").fill(code);
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

  const fetchImpl = deps.fetch ?? fetch;
  const basicAuthConfirmed = await confirmBasicAuthGate({ fetchImpl, previewUrl: guard.config.previewUrl });
  if (!basicAuthConfirmed) return { ok: false, code: "BASIC_AUTH_GATE_NOT_CONFIRMED" };

  const supabase = deps.createSupabase ? deps.createSupabase() : await defaultCreateSupabase();
  const browser = await (deps.launchBrowser ?? defaultLaunchBrowser)();
  const context = await browser.newContext({
    httpCredentials: {
      username: "admin",
      password: guard.config.basicAuthSecret,
    },
  });
  const page = await context.newPage();
  const promptForOtp = deps.promptForOtp ?? defaultPromptForOtp;
  const revokeSessionsForEmail =
    deps.revokeSessionsForEmail ??
    ((params: { env: NodeJS.ProcessEnv; supabase: PreviewAdminSupabase }) => revokePreviewAdminSessionsForEmail(params));
  const disableAdmin =
    deps.disableAdmin ??
    ((params: { env: NodeJS.ProcessEnv; supabase: PreviewAdminSupabase }) => disablePreviewAdmin(params));
  let cleanupOk = false;

  try {
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
    await page.waitForURL(originUrl("/dashboard/login", guard.config.previewUrl));

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
    await page.waitForURL(originUrl("/dashboard/login", guard.config.previewUrl));

    const cleanup = await disableAdmin({ env, supabase });
    cleanupOk = cleanup.ok;
    if (!cleanup.ok) return { ok: false, code: "CLEANUP_FAILED" };

    return { ok: true };
  } finally {
    if (!cleanupOk) {
      const cleanup = await disableAdmin({ env, supabase }).catch(() => ({ ok: false }));
      if (!cleanup.ok) cleanupOk = false;
    }
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

export function runPreviewDashboardAuthE2E(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true } | { ok: false; code: string }> {
  return runPreviewDashboardAuthE2EWithDeps(env);
}
