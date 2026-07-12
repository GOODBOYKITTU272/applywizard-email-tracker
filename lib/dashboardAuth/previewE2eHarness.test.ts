import { describe, expect, it } from "vitest";

import { validatePreviewE2eEnvironment } from "../../scripts/dashboard-auth/previewE2eHarness";

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DASHBOARD_AUTH_E2E_TARGET: "preview",
    DASHBOARD_PREVIEW_URL: "https://applywizard-email-tracker-git-worker-preflight-preview.vercel.app",
    DASHBOARD_TEST_ADMIN_EMAIL: "dashboard-auth-test@applywizz.ai",
    DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    DASHBOARD_SECRET: "basic-auth-secret",
    ...overrides,
  };
}

describe("preview E2E harness guards", () => {
  it("refuses production URL", () => {
    expect(
      validatePreviewE2eEnvironment(
        env({
          DASHBOARD_PREVIEW_URL: "https://email-apply-wizz.vercel.app",
        }),
      ),
    ).toEqual({ ok: false, code: "PRODUCTION_URL" });
  });

  it("refuses missing Preview URL", () => {
    expect(validatePreviewE2eEnvironment(env({ DASHBOARD_PREVIEW_URL: "" }))).toEqual({
      ok: false,
      code: "MISSING_PREVIEW_URL",
    });
  });

  it("refuses mismatched Supabase project", () => {
    expect(
      validatePreviewE2eEnvironment(
        env({
          NEXT_PUBLIC_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
        }),
      ),
    ).toEqual({ ok: false, code: "PROJECT_REF_MISMATCH" });
  });

  it("requires the Preview target flag", () => {
    expect(validatePreviewE2eEnvironment(env({ DASHBOARD_AUTH_E2E_TARGET: "production" }))).toEqual({
      ok: false,
      code: "INVALID_TARGET",
    });
  });

  it("does not run without required safety configuration", () => {
    expect(validatePreviewE2eEnvironment(env({ DASHBOARD_TEST_ADMIN_EMAIL: "" }))).toEqual({
      ok: false,
      code: "MISSING_EMAIL",
    });
    expect(validatePreviewE2eEnvironment(env({ DASHBOARD_SECRET: "" }))).toEqual({
      ok: false,
      code: "MISSING_BASIC_AUTH_SECRET",
    });
    expect(validatePreviewE2eEnvironment(env({ SUPABASE_SERVICE_ROLE_KEY: "" }))).toEqual({
      ok: false,
      code: "MISSING_SERVICE_ROLE_KEY",
    });
  });

  it("accepts an explicitly configured Preview target", () => {
    expect(validatePreviewE2eEnvironment(env())).toEqual({
      ok: true,
      config: {
        previewUrl: "https://applywizard-email-tracker-git-worker-preflight-preview.vercel.app",
        normalizedEmail: "dashboard-auth-test@applywizz.ai",
        projectRef: "abcdefghijklmnopqrst",
        basicAuthSecret: "basic-auth-secret",
      },
    });
  });
});
