import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { revokeDashboardSessionsForUser } from "@/lib/dashboardAuth/sessionStore";

import {
  disablePreviewAdmin,
  seedPreviewAdmin,
  type PreviewAdminLogger,
  type PreviewAdminSupabase,
} from "./previewAdminTool";

const logger: PreviewAdminLogger = {
  info: (message) => console.log(`[DashboardAuthPreviewAdmin] ${message}`),
  error: (message) => console.error(`[DashboardAuthPreviewAdmin] ${message}`),
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const supabase = createSupabaseServiceRoleClient() as unknown as PreviewAdminSupabase;
  const dryRun = args.includes("--dry-run");

  const result = args.includes("--disable")
    ? await disablePreviewAdmin({
        env: process.env,
        supabase,
        revokeAllSessionsForUser: async (userId) => revokeDashboardSessionsForUser(userId),
        logger,
      })
    : await seedPreviewAdmin({
        env: process.env,
        supabase,
        dryRun,
        logger,
      });

  if (!result.ok) {
    logger.error(`failed code=${result.code}`);
    process.exitCode = 1;
  }
}

main().catch(() => {
  logger.error("failed code=UNKNOWN_ERROR");
  process.exitCode = 1;
});
