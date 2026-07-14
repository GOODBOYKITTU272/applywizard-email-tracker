import { NextResponse } from "next/server";
import { syncTrackerMailbox } from "@/lib/worker-core/syncTrackerMailbox";

export async function POST() {
  try {
    const result = await syncTrackerMailbox();
    return NextResponse.json({ message: "Sync complete", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Zoho Mail Sync] Error:", message);
    const status =
      message.includes("No active Zoho connection") ? 404
      : message.includes("configuration is incomplete") ? 500
      : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
