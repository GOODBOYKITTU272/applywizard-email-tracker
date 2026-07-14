import { pathToFileURL } from "node:url";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

import {
  disablePreviewAdmin,
  seedPreviewAdmin,
  validatePreviewAdminConfig,
  type PreviewAdminLogger,
  type PreviewAdminSupabase,
  type PreviewAdminToolResult,
} from "./previewAdminTool";

const logger: PreviewAdminLogger = {
  info: (message) => console.log(`[DashboardAuthPreviewAdmin] ${message}`),
  error: (message) => console.error(`[DashboardAuthPreviewAdmin] ${message}`),
};

const ALLOWED_FLAGS = new Set(["--dry-run", "--disable"]);

interface SeedPreviewAdminCliParams {
  args: string[];
  env: NodeJS.ProcessEnv;
  createSupabase: () => PreviewAdminSupabase;
  logger?: PreviewAdminLogger;
}

export async function runSeedPreviewAdminCli(
  params: SeedPreviewAdminCliParams,
): Promise<PreviewAdminToolResult> {
  const loggerForRun = params.logger ?? logger;
  const hasUnknownFlag = params.args.some((arg) => arg.startsWith("--") && !ALLOWED_FLAGS.has(arg));
  if (hasUnknownFlag) {
    const result: PreviewAdminToolResult = { ok: false, code: "UNKNOWN_FLAG" };
    loggerForRun.error(`failed code=${result.code}`);
    return result;
  }

  const dryRun = params.args.includes("--dry-run");
  const disable = params.args.includes("--disable");

  if (disable && dryRun) {
    const result: PreviewAdminToolResult = { ok: false, code: "CONFLICTING_FLAGS" };
    loggerForRun.error(`failed code=${result.code}`);
    return result;
  }

  const validation = validatePreviewAdminConfig(params.env);
  if (!validation.ok) {
    loggerForRun.error(`failed code=${validation.code}`);
    return validation;
  }

  const supabase = params.createSupabase();
  const result = disable
    ? await disablePreviewAdmin({
        env: params.env,
        supabase,
        logger: loggerForRun,
      })
    : await seedPreviewAdmin({
        env: params.env,
        supabase,
        dryRun,
        logger: loggerForRun,
      });

  if (!result.ok) {
    loggerForRun.error(`failed code=${result.code}`);
  }

  return result;
}

async function main(): Promise<void> {
  const result = await runSeedPreviewAdminCli({
    args: process.argv.slice(2),
    env: process.env,
    createSupabase: () => createSupabaseServiceRoleClient() as unknown as PreviewAdminSupabase,
    logger,
  });

  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    logger.error("failed code=UNKNOWN_ERROR");
    process.exitCode = 1;
  });
}
