import { describe, expect, it } from "vitest";

import {
  parseSyncArgs,
  PREVIEW_REF,
  PRODUCTION_REF,
  resolveSyncEnvGuard,
} from "@/lib/leadsSync/syncCommand";

const previewEnv = {
  LEADS_API_BASE_URL: "https://leads.example.test/api/v1/leads/",
  LEADS_API_USERNAME: "user",
  LEADS_API_PASSWORD: "password",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PROJECT_REF: PREVIEW_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_REF}.supabase.co`,
} as NodeJS.ProcessEnv;

const productionEnv = {
  ...previewEnv,
  SUPABASE_PROJECT_REF: PRODUCTION_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
} as NodeJS.ProcessEnv;

describe("parseSyncArgs", () => {
  it("defaults to dry-run when no mode flag is given", () => {
    expect(parseSyncArgs([])).toEqual({ ok: true, mode: "dry-run", confirmProduction: false });
  });

  it("honors explicit --dry-run and --apply", () => {
    expect(parseSyncArgs(["--dry-run"])).toEqual({ ok: true, mode: "dry-run", confirmProduction: false });
    expect(parseSyncArgs(["--apply"])).toEqual({ ok: true, mode: "apply", confirmProduction: false });
    expect(parseSyncArgs(["--apply", "--confirm-production"])).toEqual({
      ok: true,
      mode: "apply",
      confirmProduction: true,
    });
  });

  it("rejects conflicting and unknown flags", () => {
    expect(parseSyncArgs(["--dry-run", "--apply"])).toEqual({ ok: false, code: "CONFLICTING_FLAGS" });
    expect(parseSyncArgs(["--force"])).toEqual({ ok: false, code: "UNKNOWN_FLAG" });
    expect(parseSyncArgs(["apply"])).toEqual({ ok: false, code: "UNKNOWN_FLAG" });
  });
});

describe("resolveSyncEnvGuard", () => {
  it("allows preview apply when URL and declared ref both resolve to preview", () => {
    expect(resolveSyncEnvGuard(previewEnv, "apply", false)).toEqual({
      ok: true,
      environment: "preview",
      projectRef: PREVIEW_REF,
    });
  });

  it("rejects URL/ref mismatch", () => {
    const env = { ...previewEnv, SUPABASE_PROJECT_REF: PRODUCTION_REF } as NodeJS.ProcessEnv;
    expect(resolveSyncEnvGuard(env, "dry-run", false)).toEqual({ ok: false, code: "SUPABASE_URL_REF_MISMATCH" });
  });

  it("rejects production apply without explicit confirmation, allows it with confirmation", () => {
    expect(resolveSyncEnvGuard(productionEnv, "apply", false)).toEqual({
      ok: false,
      code: "PRODUCTION_APPLY_NOT_CONFIRMED",
    });
    expect(resolveSyncEnvGuard(productionEnv, "apply", true)).toEqual({
      ok: true,
      environment: "production",
      projectRef: PRODUCTION_REF,
    });
  });

  it("allows production dry-run read-only without confirmation", () => {
    expect(resolveSyncEnvGuard(productionEnv, "dry-run", false)).toEqual({
      ok: true,
      environment: "production",
      projectRef: PRODUCTION_REF,
    });
  });

  it("rejects missing credentials, keys, refs, and unknown projects", () => {
    expect(resolveSyncEnvGuard({ ...previewEnv, LEADS_API_PASSWORD: "" } as NodeJS.ProcessEnv, "dry-run", false))
      .toEqual({ ok: false, code: "MISSING_LEADS_CREDENTIALS" });
    expect(resolveSyncEnvGuard({ ...previewEnv, SUPABASE_SERVICE_ROLE_KEY: " " } as NodeJS.ProcessEnv, "dry-run", false))
      .toEqual({ ok: false, code: "MISSING_SERVICE_ROLE_KEY" });
    expect(resolveSyncEnvGuard({ ...previewEnv, SUPABASE_PROJECT_REF: "" } as NodeJS.ProcessEnv, "dry-run", false))
      .toEqual({ ok: false, code: "MISSING_PROJECT_REF" });
    expect(resolveSyncEnvGuard({ ...previewEnv, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" } as NodeJS.ProcessEnv, "dry-run", false))
      .toEqual({ ok: false, code: "SUPABASE_URL_UNRESOLVED" });

    const strangerRef = "aaaaaaaaaaaaaaaaaaaa";
    const strangerEnv = {
      ...previewEnv,
      SUPABASE_PROJECT_REF: strangerRef,
      NEXT_PUBLIC_SUPABASE_URL: `https://${strangerRef}.supabase.co`,
    } as NodeJS.ProcessEnv;
    expect(resolveSyncEnvGuard(strangerEnv, "apply", true)).toEqual({ ok: false, code: "UNKNOWN_PROJECT_REF" });
  });
});
