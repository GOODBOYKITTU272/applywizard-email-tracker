import Module from "module";
import { join } from "path";

type Mode = "sync" | "classify" | "recovery" | "sync-clients";

const mode = process.argv[2] as Mode | undefined;

if (!mode) {
  console.log("Usage: npm run worker:once -- <sync|classify|recovery|sync-clients> [--confirm-production]");
  process.exit(0);
}

if (!["sync", "classify", "recovery", "sync-clients"].includes(mode)) {
  console.error("Invalid worker mode. Use one of: sync, classify, recovery, sync-clients.");
  process.exit(1);
}

const root = join(__dirname, "..");
const moduleResolver = Module as typeof Module & {
  _resolveFilename(request: string, parent?: NodeModule, isMain?: boolean, options?: unknown): string;
};
const originalResolveFilename = moduleResolver._resolveFilename;

moduleResolver._resolveFilename = function resolveWorkerAlias(request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) {
    return originalResolveFilename.call(this, join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

async function main() {
  if (mode === "sync") {
    const { syncTrackerMailbox } = await import("@/lib/worker-core/syncTrackerMailbox");
    console.log(await syncTrackerMailbox());
    return;
  }

  if (mode === "sync-clients") {
    // Client sync only: no Zoho sync, no classification, no backlog processing.
    // Aggregate-only output; environment guards (including production
    // confirmation) are enforced inside runWorkerOnceSyncClients.
    const { runWorkerOnceSyncClients } = await import("@/lib/worker-core/leadsClientSync");
    const result = await runWorkerOnceSyncClients(process.env, process.argv.slice(3));
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (mode === "classify") {
    if (process.env.WORKER_CLASSIFY_BATCH_SIZE && !process.env.ZOHO_CLASSIFY_MAX_PER_RUN) {
      process.env.ZOHO_CLASSIFY_MAX_PER_RUN = process.env.WORKER_CLASSIFY_BATCH_SIZE;
    }
    const { classifyQueue } = await import("@/lib/worker-core/classifyQueue");
    console.log(await classifyQueue());
    return;
  }

  const { recoverQueue } = await import("@/lib/worker-core/recoverQueue");
  console.log(await recoverQueue());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Worker run failed.");
  process.exit(1);
});
