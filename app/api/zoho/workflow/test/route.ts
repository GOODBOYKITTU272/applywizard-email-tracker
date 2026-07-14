/**
 * Phase 6A — Manual sync + classification orchestrator.
 *
 * POST /api/zoho/workflow/test
 *
 * Runs a full sync cycle followed by a classification cycle and returns
 * a combined summary. No cron, no daemon, no scheduling — manual trigger only.
 *
 * Safe logging rule: never log access tokens, refresh tokens, or email content.
 */

import { NextResponse } from "next/server";
import { syncTrackerMailbox } from "@/lib/worker-core/syncTrackerMailbox";
import { classifyQueue } from "@/lib/worker-core/classifyQueue";

export async function POST() {
  // Step 1 — Sync latest email metadata from Zoho
  let syncResult;
  try {
    syncResult = await syncTrackerMailbox();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    console.error("[Zoho Workflow] Sync step failed:", message);
    const status =
      message.includes("No active Zoho connection") ? 404
      : message.includes("configuration is incomplete") ? 500
      : 502;
    return NextResponse.json(
      { error: `Sync failed: ${message}` },
      { status },
    );
  }

  // Step 2 — Classify any newly inserted or retryable-failed records
  let classifyResult;
  try {
    classifyResult = await classifyQueue();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown classify error";
    console.error("[Zoho Workflow] Classification step failed:", message);
    // Sync succeeded — return partial result with classification error
    return NextResponse.json(
      {
        message: "Sync succeeded but classification failed",
        sync: syncResult,
        classificationError: message,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    message: "Sync and classification complete",
    sync: syncResult,
    classification: classifyResult,
  });
}
