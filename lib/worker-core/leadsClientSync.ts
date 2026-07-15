// leadsClientSync — worker-facing wrapper around the approved S2 Leads sync
// (Live Monitor V1, Phase S3). Resolves worker configuration from env and runs
// one apply-mode sync through the exact S2 path (fetch → normalize → lock →
// client_sync_runs → batched upsert). No Zoho modules are touched.

import { fetchAllLeads } from "@/lib/leadsSync/fetchLeads";
import { runClientSync, type ClientSyncReport, type SyncSupabase } from "@/lib/leadsSync/syncClients";
import { resolveSyncEnvGuard, type SyncEnvironment } from "@/lib/leadsSync/syncCommand";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

export type { ClientSyncReport, SyncEnvironment };

export const DEFAULT_LEADS_SYNC_INTERVAL_MS = 600_000; // 10 minutes (approved)
// First run is staggered so it never starts at the same instant as the Zoho
// sync/classify loops that begin immediately at worker startup.
export const DEFAULT_LEADS_SYNC_STARTUP_DELAY_MS = 20_000;

/**
 * Worker scheduling config, resolved once at loop start.
 * - `disabled`: WORKER_LEADS_SYNC_ENABLED is not "true" (explicit opt-in, so a
 *   deploy never starts syncing before Preview approval).
 * - `not_configured`: enabled but Leads credentials are absent — the worker
 *   keeps running (Zoho loops and health server unaffected).
 * - `guard_failed`: enabled + configured, but the S2 environment guard refused
 *   (e.g. production without WORKER_LEADS_SYNC_CONFIRM_PRODUCTION=true).
 * - `ready`: loop may run.
 */
export type LeadsWorkerConfig =
  | { status: "disabled"; configured: boolean }
  | { status: "not_configured"; configured: false }
  | { status: "guard_failed"; configured: true; guardCode: string }
  | { status: "ready"; configured: true; environment: SyncEnvironment; projectRef: string };

function leadsCredentialsPresent(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.LEADS_API_BASE_URL?.trim() && env.LEADS_API_USERNAME?.trim() && env.LEADS_API_PASSWORD?.trim(),
  );
}

export function resolveLeadsWorkerConfig(env: NodeJS.ProcessEnv): LeadsWorkerConfig {
  const configured = leadsCredentialsPresent(env);
  if (env.WORKER_LEADS_SYNC_ENABLED !== "true") return { status: "disabled", configured };
  if (!configured) return { status: "not_configured", configured: false };

  const guard = resolveSyncEnvGuard(env, "apply", env.WORKER_LEADS_SYNC_CONFIRM_PRODUCTION === "true");
  if (!guard.ok) return { status: "guard_failed", configured: true, guardCode: guard.code };
  return { status: "ready", configured: true, environment: guard.environment, projectRef: guard.projectRef };
}

export interface LeadsSyncRunDeps {
  supabase?: SyncSupabase;
  fetchLeads?: () => ReturnType<typeof fetchAllLeads>;
}

/** One scheduled apply-mode sync run through the approved S2 path. */
export async function runLeadsClientSyncApply(
  target: { environment: SyncEnvironment; projectRef: string },
  deps: LeadsSyncRunDeps = {},
): Promise<ClientSyncReport> {
  return runClientSync({
    mode: "apply",
    environment: target.environment,
    projectRef: target.projectRef,
    supabase: deps.supabase ?? (createSupabaseServiceRoleClient() as unknown as SyncSupabase),
    fetchLeads: deps.fetchLeads ?? (() => fetchAllLeads()),
  });
}

const WORKER_ONCE_ALLOWED_FLAGS = new Set(["--confirm-production"]);

export type WorkerOnceSyncClientsResult = ClientSyncReport | { ok: false; errorCode: string };

/**
 * `npm run worker:once -- sync-clients [--confirm-production]`
 *
 * Manual invocation is itself the explicit intent, so it does not require
 * WORKER_LEADS_SYNC_ENABLED — but it enforces the full S2 environment guard,
 * including the production confirmation flag. Apply mode only (dry-run lives
 * in `npm run sync:clients`). Runs client sync exclusively: no Zoho sync, no
 * classification, no backlog processing.
 */
export async function runWorkerOnceSyncClients(
  env: NodeJS.ProcessEnv,
  argv: string[],
  deps: LeadsSyncRunDeps = {},
): Promise<WorkerOnceSyncClientsResult> {
  const unknown = argv.find((arg) => !WORKER_ONCE_ALLOWED_FLAGS.has(arg));
  if (unknown) return { ok: false, errorCode: "UNKNOWN_FLAG" };

  const guard = resolveSyncEnvGuard(env, "apply", argv.includes("--confirm-production"));
  if (!guard.ok) return { ok: false, errorCode: guard.code };

  return runLeadsClientSyncApply(guard, deps);
}
