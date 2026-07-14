import { optionsFromEnv, runHistoricalRelease } from "@/lib/zoho/releaseHistoricalBatch";

async function main() {
  const options = optionsFromEnv(process.argv.slice(2));
  const result = await runHistoricalRelease(options);

  if (!result.ok) {
    console.error(`[Release] failed code=${result.code}`);
    process.exitCode = 1;
    return;
  }

  if (result.dryRun) {
    console.log(`[Release] dry_run=true eligible_historical_ingested=${result.eligibleCount}`);
    return;
  }

  console.log(`[Release] dry_run=false batch_id=${result.batchId} released_count=${result.releasedCount}`);
}

main().catch(() => {
  console.error(`[Release] failed code=RELEASE_UNKNOWN_ERROR`);
  process.exitCode = 1;
});
