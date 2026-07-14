import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import {
  optionsFromEnv,
  runZohoHistoryBackfill,
  toBackfillErrorCode,
  type BackfillDeps,
} from "@/lib/zoho/backfillZohoHistory";

let stopRequested = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopRequested = true;
    console.log(`[Zoho Backfill] stop requested signal=${signal}`);
  });
}

async function main() {
  const options = optionsFromEnv(process.argv.slice(2));

  await runZohoHistoryBackfill(options, {
    supabase: createSupabaseServiceRoleClient() as unknown as BackfillDeps["supabase"],
    fetchImpl: (url, init) => fetch(url, init as RequestInit),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
    log: (message) => console.log(message),
    shouldStop: () => stopRequested,
  });
}

main().catch((error: unknown) => {
  console.error(`[Zoho Backfill] failed code=${toBackfillErrorCode(error)}`);
  process.exitCode = 1;
});
