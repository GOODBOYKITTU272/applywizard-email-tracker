// sync:clients — manual Leads API → Supabase clients sync runner.
//
//   npm run sync:clients -- --dry-run   (default when no mode flag is given)
//   npm run sync:clients -- --apply
//   npm run sync:clients -- --apply --confirm-production   (production only)
//
// Output is aggregate-only: counts, mode, environment, and deterministic error
// codes. Never prints credentials, Authorization headers, client records, or
// email addresses.

import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { fetchAllLeads } from "@/lib/leadsSync/fetchLeads";
import { runClientSync, type SyncSupabase } from "@/lib/leadsSync/syncClients";
import { parseSyncArgs, resolveSyncEnvGuard } from "@/lib/leadsSync/syncCommand";

const USAGE = "Usage: npm run sync:clients -- [--dry-run|--apply] [--confirm-production]";

async function main(): Promise<void> {
  const parsed = parseSyncArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`[sync:clients] ${parsed.code}`);
    console.error(USAGE);
    process.exit(1);
  }

  const guard = resolveSyncEnvGuard(process.env, parsed.mode, parsed.confirmProduction);
  if (!guard.ok) {
    console.error(`[sync:clients] ${guard.code}`);
    process.exit(1);
  }

  console.log(`[sync:clients] mode=${parsed.mode} environment=${guard.environment}`);

  const report = await runClientSync({
    mode: parsed.mode,
    environment: guard.environment,
    projectRef: guard.projectRef,
    supabase: createSupabaseServiceRoleClient() as unknown as SyncSupabase,
    fetchLeads: () => fetchAllLeads(),
  });

  // Aggregate counts and codes only — safe to log anywhere.
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 1);
}

main().catch(() => {
  // Never print the raw error — it could embed request/config details.
  console.error("[sync:clients] SYNC_UNEXPECTED_ERROR");
  process.exit(1);
});
