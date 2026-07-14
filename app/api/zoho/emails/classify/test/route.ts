import { NextResponse } from "next/server";
import { classifyQueue } from "@/lib/worker-core/classifyQueue";

export async function POST() {
  try {
    const result = await classifyQueue();
    return NextResponse.json({ message: "Classification complete", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Zoho Mail Classify] Error:", message);
    const status =
      message.includes("No active Zoho connection") ? 404
      : message.includes("configuration is incomplete") ? 500
      : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
