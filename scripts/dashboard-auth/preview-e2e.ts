import { runPreviewDashboardAuthE2E } from "./previewE2eHarness";

async function main(): Promise<void> {
  const result = await runPreviewDashboardAuthE2E(process.env);
  if (!result.ok) {
    console.error(`[DashboardAuthPreviewE2E] failed code=${result.code}`);
    process.exitCode = 1;
    return;
  }

  console.log("[DashboardAuthPreviewE2E] passed sanitized=true");
}

main().catch(() => {
  console.error("[DashboardAuthPreviewE2E] failed code=UNKNOWN_ERROR");
  process.exitCode = 1;
});
