/**
 * Phase 6B — Protected scheduled cron trigger.
 *
 * GET /api/zoho/workflow/cron
 *
 * Invoked automatically by Vercel Cron once daily (see vercel.json).
 * Vercel supplies the Authorization header automatically from the
 * CRON_SECRET environment variable.
 *
 * Security rules:
 *   - If CRON_SECRET is not configured on the server → 401 (fail closed).
 *   - If Authorization header is missing or does not match
 *     "Bearer <CRON_SECRET>" exactly → 401.
 *   - Never log CRON_SECRET, tokens, email bodies, or authorization values.
 */

import { NextRequest, NextResponse } from "next/server";
import { syncEmails } from "@/lib/zoho/syncEmails";
import { classifyEmails } from "@/lib/zoho/classifyEmails";
import { acquireCronLock, releaseCronLock } from "@/lib/zoho/cronLock";

export async function GET(req: NextRequest) {
  // ── Authorization ─────────────────────────────────────────────────────────

  const cronSecret = process.env.CRON_SECRET;

  // Fail closed: if the secret is not configured, deny all access.
  if (!cronSecret || cronSecret.trim() === "") {
    console.error("[Zoho Cron] CRON_SECRET is not configured. Request denied.");
    return NextResponse.json(
      { error: "Cron endpoint is not configured." },
      { status: 401 },
    );
  }

  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${cronSecret}`;

  if (!authHeader || authHeader !== expected) {
    // Log only that auth failed — never log the header value or secret.
    console.error("[Zoho Cron] Unauthorized request. Authorization header missing or invalid.");
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }

  // ── Concurrency lock ──────────────────────────────────────────────────────

  let locked = false;
  try {
    locked = await acquireCronLock();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown lock error";
    console.error("[Zoho Cron] Lock acquisition failed:", message);
    return NextResponse.json({ error: "Failed to acquire cron lock." }, { status: 500 });
  }

  if (!locked) {
    console.log("[Zoho Cron] Skipped — another run is already active.");
    return NextResponse.json({ message: "Skipped — another run is already active." }, { status: 200 });
  }

  // ── Workflow ───────────────────────────────────────────────────────────────

  console.log("[Zoho Cron] Triggered — running sync + classification.");

  try {
    // Step 1 — Sync latest email metadata from Zoho
    let syncResult;
    try {
      syncResult = await syncEmails();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown sync error";
      console.error("[Zoho Cron] Sync step failed:", message);
      const status =
        message.includes("No active Zoho connection") ? 404
        : message.includes("configuration is incomplete") ? 500
        : 502;
      return NextResponse.json({ error: `Sync failed: ${message}` }, { status });
    }

    // Step 2 — Classify any newly inserted or retryable-failed records
    let classifyResult;
    try {
      classifyResult = await classifyEmails();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown classify error";
      console.error("[Zoho Cron] Classification step failed:", message);
      return NextResponse.json(
        { message: "Sync succeeded but classification failed", sync: syncResult, classificationError: message },
        { status: 502 },
      );
    }

    console.log(
      `[Zoho Cron] Complete — sync fetched: ${syncResult.fetched}, classify checked: ${classifyResult.checked}, classified: ${classifyResult.classified}`,
    );

    return NextResponse.json({
      message: "Sync and classification complete",
      sync: syncResult,
      classification: classifyResult,
    });
  } finally {
    await releaseCronLock();
  }
}
