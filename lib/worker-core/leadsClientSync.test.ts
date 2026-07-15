import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEADS_SYNC_INTERVAL_MS,
  DEFAULT_LEADS_SYNC_STARTUP_DELAY_MS,
  resolveLeadsWorkerConfig,
  runWorkerOnceSyncClients,
} from "@/lib/worker-core/leadsClientSync";
import type { FetchLeadsResult } from "@/lib/leadsSync/fetchLeads";
import type { SyncSupabase } from "@/lib/leadsSync/syncClients";
import { PREVIEW_REF, PRODUCTION_REF } from "@/lib/leadsSync/syncCommand";

const previewEnv = {
  LEADS_API_BASE_URL: "https://leads.example.test/api/v1/leads/",
  LEADS_API_USERNAME: "user",
  LEADS_API_PASSWORD: "password",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_PROJECT_REF: PREVIEW_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_REF}.supabase.co`,
  WORKER_LEADS_SYNC_ENABLED: "true",
} as NodeJS.ProcessEnv;

const productionEnv = {
  ...previewEnv,
  SUPABASE_PROJECT_REF: PRODUCTION_REF,
  NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
} as NodeJS.ProcessEnv;

/** Minimal always-succeeding fake that records which tables were touched. */
function createFakeSupabase() {
  const tablesTouched = new Set<string>();
  const ok = Promise.resolve({ data: null, error: null });
  const supabase = {
    from(table: string) {
      tablesTouched.add(table);
      const chain = {
        eq: () => chain,
        lt: () => ok,
        then: ok.then.bind(ok),
      };
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        insert: () => ok,
        update: () => ({ eq: () => ok }),
        delete: () => chain,
        upsert: () => ok,
      };
    },
  };
  return { supabase: supabase as unknown as SyncSupabase, tablesTouched };
}

const fetchLeads = async (): Promise<FetchLeadsResult> => ({
  leads: [{ id: 1, name: "Client", email: "c@applywizard.ai" }],
  declaredCount: 1,
  httpStatus: 200,
  pages: 1,
});

describe("resolveLeadsWorkerConfig", () => {
  it("uses the approved 10-minute interval and a staggered startup delay", () => {
    expect(DEFAULT_LEADS_SYNC_INTERVAL_MS).toBe(600_000);
    expect(DEFAULT_LEADS_SYNC_STARTUP_DELAY_MS).toBeGreaterThanOrEqual(15_000);
    expect(DEFAULT_LEADS_SYNC_STARTUP_DELAY_MS).toBeLessThanOrEqual(30_000);
  });

  it("is disabled unless WORKER_LEADS_SYNC_ENABLED is exactly 'true'", () => {
    expect(resolveLeadsWorkerConfig({ ...previewEnv, WORKER_LEADS_SYNC_ENABLED: undefined }))
      .toEqual({ status: "disabled", configured: true });
    expect(resolveLeadsWorkerConfig({ ...previewEnv, WORKER_LEADS_SYNC_ENABLED: "1" }))
      .toEqual({ status: "disabled", configured: true });
  });

  it("reports not_configured (without crashing) when Leads credentials are missing", () => {
    expect(resolveLeadsWorkerConfig({ ...previewEnv, LEADS_API_PASSWORD: "" }))
      .toEqual({ status: "not_configured", configured: false });
    // Disabled AND unconfigured still resolves — the worker keeps running either way.
    expect(resolveLeadsWorkerConfig({} as NodeJS.ProcessEnv))
      .toEqual({ status: "disabled", configured: false });
  });

  it("is ready on preview, and guard_failed on production without explicit confirmation", () => {
    expect(resolveLeadsWorkerConfig(previewEnv)).toEqual({
      status: "ready",
      configured: true,
      environment: "preview",
      projectRef: PREVIEW_REF,
    });
    expect(resolveLeadsWorkerConfig(productionEnv)).toEqual({
      status: "guard_failed",
      configured: true,
      guardCode: "PRODUCTION_APPLY_NOT_CONFIRMED",
    });
    expect(resolveLeadsWorkerConfig({ ...productionEnv, WORKER_LEADS_SYNC_CONFIRM_PRODUCTION: "true" }))
      .toEqual({ status: "ready", configured: true, environment: "production", projectRef: PRODUCTION_REF });
  });
});

describe("runWorkerOnceSyncClients", () => {
  it("runs only the client sync apply path — no Zoho tables, no classification", async () => {
    const { supabase, tablesTouched } = createFakeSupabase();

    const result = await runWorkerOnceSyncClients(previewEnv, [], { supabase, fetchLeads });

    expect(result.ok).toBe(true);
    expect([...tablesTouched].sort()).toEqual(["client_sync_runs", "clients", "cron_locks"]);
    expect(tablesTouched.has("zoho_email_metadata")).toBe(false);
    expect(tablesTouched.has("zoho_connections")).toBe(false);
  });

  it("rejects unknown flags and enforces the environment guard", async () => {
    const { supabase } = createFakeSupabase();
    expect(await runWorkerOnceSyncClients(previewEnv, ["--apply"], { supabase, fetchLeads }))
      .toEqual({ ok: false, errorCode: "UNKNOWN_FLAG" });
    expect(await runWorkerOnceSyncClients({ ...previewEnv, LEADS_API_USERNAME: "" }, [], { supabase, fetchLeads }))
      .toEqual({ ok: false, errorCode: "MISSING_LEADS_CREDENTIALS" });
  });

  it("still requires explicit production confirmation", async () => {
    const { supabase, tablesTouched } = createFakeSupabase();
    expect(await runWorkerOnceSyncClients(productionEnv, [], { supabase, fetchLeads }))
      .toEqual({ ok: false, errorCode: "PRODUCTION_APPLY_NOT_CONFIRMED" });
    expect(tablesTouched.size).toBe(0);

    const confirmed = await runWorkerOnceSyncClients(productionEnv, ["--confirm-production"], {
      supabase,
      fetchLeads,
    });
    expect(confirmed.ok).toBe(true);
  });

  it("returns aggregate-only output — no PII or credentials", async () => {
    const { supabase } = createFakeSupabase();
    const result = await runWorkerOnceSyncClients(previewEnv, [], { supabase, fetchLeads });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("Client");
  });
});
