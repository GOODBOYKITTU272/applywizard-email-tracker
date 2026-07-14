import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  buildTestClientCleanupFilter,
  buildTestClientRow,
  redactRecipient,
  resolveLiveMonitorSeedGuard,
  resolveTestClientConfig,
} from "@/lib/liveMonitor/testClient";

const ALLOWED_FLAGS = new Set(["--dry-run", "--apply", "--cleanup"]);
type Mode = "dry-run" | "apply" | "cleanup";

type QueryResult = { data: unknown[] | null; error: { message: string } | null };

interface DeleteChain {
  eq(column: string, value: string): DeleteChain;
  select(columns: string): Promise<QueryResult>;
}

interface SeedClientSupabase {
  from(table: string): {
    upsert(row: Record<string, unknown>, options: { onConflict: string }): { select(columns: string): Promise<QueryResult> };
    delete(): DeleteChain;
  };
}

export interface SeedClientDeps {
  createSupabase: () => SeedClientSupabase;
  logger?: { info: (m: string) => void; error: (m: string) => void };
}

function parseMode(args: string[]): Mode | { error: string } {
  const unknown = args.find((a) => a.startsWith("--") && !ALLOWED_FLAGS.has(a));
  if (unknown) return { error: "UNKNOWN_FLAG" };
  if (args.includes("--cleanup") && (args.includes("--apply") || args.includes("--dry-run"))) {
    return { error: "CONFLICTING_FLAGS" };
  }
  if (args.includes("--cleanup")) return "cleanup";
  if (args.includes("--apply")) return "apply";
  return "dry-run";
}

export async function runSeedTestClientCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  deps: SeedClientDeps,
): Promise<{ ok: true; mode: Mode; affected: number } | { ok: false; code: string }> {
  const log = deps.logger ?? { info: (m: string) => console.log(m), error: (m: string) => console.error(m) };

  const mode = parseMode(args);
  if (typeof mode !== "string") {
    log.error(`[LiveMonitorSeed] failed code=${mode.error}`);
    return { ok: false, code: mode.error };
  }

  // All guards run before any Supabase client is created.
  const guard = resolveLiveMonitorSeedGuard(env);
  if (!guard.ok) {
    log.error(`[LiveMonitorSeed] refused code=${guard.code}`);
    return { ok: false, code: guard.code };
  }
  const config = resolveTestClientConfig(env);
  if (!config.ok) {
    log.error(`[LiveMonitorSeed] failed code=${config.code}`);
    return { ok: false, code: config.code };
  }

  if (mode === "dry-run") {
    log.info(
      `[LiveMonitorSeed] dry-run target=preview marker=live_monitor_v1_test_client recipient=${redactRecipient(config.normalizedRecipient)} would_upsert=1 writes=0`,
    );
    return { ok: true, mode, affected: 0 };
  }

  const supabase = deps.createSupabase();

  if (mode === "cleanup") {
    const filter = buildTestClientCleanupFilter(config.normalizedRecipient);
    let q = supabase.from("clients").delete();
    for (const f of filter) q = q.eq(f.column, f.value);
    const result = await q.select("id");
    if (result.error) {
      log.error("[LiveMonitorSeed] failed code=CLEANUP_FAILED");
      return { ok: false, code: "CLEANUP_FAILED" };
    }
    const affected = result.data?.length ?? 0;
    log.info(`[LiveMonitorSeed] cleanup removed=${affected} recipient=${redactRecipient(config.normalizedRecipient)}`);
    return { ok: true, mode, affected };
  }

  // apply — idempotent upsert on the generated normalized column.
  const upserted = await supabase
    .from("clients")
    .upsert(buildTestClientRow(config.recipient), { onConflict: "recipient_email_normalized" })
    .select("id");
  if (upserted.error || !upserted.data) {
    log.error("[LiveMonitorSeed] failed code=UPSERT_FAILED");
    return { ok: false, code: "UPSERT_FAILED" };
  }
  log.info(
    `[LiveMonitorSeed] apply upserted=${upserted.data.length} recipient=${redactRecipient(config.normalizedRecipient)} client=Preview Test Client`,
  );
  return { ok: true, mode, affected: upserted.data.length };
}

async function main(): Promise<void> {
  const result = await runSeedTestClientCli(process.argv.slice(2), process.env, {
    createSupabase: () =>
      createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      }) as unknown as ReturnType<SeedClientDeps["createSupabase"]>,
  });
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("[LiveMonitorSeed] failed code=UNKNOWN_ERROR");
    process.exitCode = 1;
  });
}
