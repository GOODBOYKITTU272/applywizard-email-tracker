import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("worker core contracts", () => {
  it("keeps sync/classify business logic importable outside Next server-only modules", () => {
    expect(read("lib/zoho/syncEmails.ts")).not.toContain('import "server-only"');
    expect(read("lib/zoho/classifyEmails.ts")).not.toContain('import "server-only"');
    expect(read("lib/supabase/server.ts")).toContain('import "server-only"');
    expect(read("lib/zoho/syncEmails.ts")).toContain("createSupabaseServiceRoleClient");
    expect(read("lib/zoho/classifyEmails.ts")).toContain("createSupabaseServiceRoleClient");
  });

  it("has worker-core wrappers for sync, classify, and recovery modes", () => {
    expect(read("lib/worker-core/syncTrackerMailbox.ts")).toContain("syncTrackerMailbox");
    expect(read("lib/worker-core/classifyQueue.ts")).toContain("classifyQueue");
    expect(read("lib/worker-core/recoverQueue.ts")).toContain("recoverQueue");
  });

  it("keeps workflow routes on worker-core wrappers and avoids browser imports", () => {
    expect(read("app/api/zoho/workflow/cron/route.ts")).toContain("@/lib/worker-core/syncTrackerMailbox");
    expect(read("app/api/zoho/workflow/cron/route.ts")).toContain("@/lib/worker-core/classifyQueue");
    expect(read("app/api/zoho/workflow/test/route.ts")).toContain("@/lib/worker-core/syncTrackerMailbox");
    expect(read("app/api/zoho/workflow/test/route.ts")).toContain("@/lib/worker-core/classifyQueue");

    const clientFiles = [
      "components/coo.tsx",
      "components/coo-page-styles.tsx",
      // The operations layout is now a server component; the actual
      // "use client" shell that must avoid worker-core imports is this one.
      "components/operations/operations-shell-client.tsx",
    ].map(read).join("\n");
    expect(clientFiles).not.toContain("worker-core");
  });

  it("documents and exposes an explicit safe worker:once command", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.["worker:once"]).toBe("tsc -p tsconfig.worker.json && node .worker-dist/scripts/worker-once.js");
    expect(read(".env.example")).toContain("WORKER_SYNC_INTERVAL_MS");
    expect(read(".env.example")).toContain("WORKER_CLASSIFY_BATCH_SIZE");
    expect(read(".env.example")).toContain("WORKER_RECOVERY_INTERVAL_MS");
  });
});
