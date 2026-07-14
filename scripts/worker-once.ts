import Module from "module";
import { join } from "path";

type Mode = "sync" | "classify" | "recovery";

const mode = process.argv[2] as Mode | undefined;

if (!mode) {
  console.log("Usage: npm run worker:once -- <sync|classify|recovery>");
  process.exit(0);
}

if (!["sync", "classify", "recovery"].includes(mode)) {
  console.error("Invalid worker mode. Use one of: sync, classify, recovery.");
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
