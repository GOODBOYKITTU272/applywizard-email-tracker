import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  PREVIEW_DEMO_CHECKPOINT_MAILBOX,
  PREVIEW_DEMO_MARKER,
  buildPreviewDemoDataset,
} from "@/lib/previewDemo/dataset";

// Delete filters kept as data so they are unit-testable and provably narrow:
// emails only by marker; the checkpoint only by marker AND its synthetic identity.
export const PREVIEW_DEMO_EMAIL_CLEANUP = { column: "folder_id", value: PREVIEW_DEMO_MARKER } as const;
export const PREVIEW_DEMO_CHECKPOINT_CLEANUP = [
  { column: "last_seen_message_id", value: PREVIEW_DEMO_MARKER },
  { column: "mailbox_email", value: PREVIEW_DEMO_CHECKPOINT_MAILBOX },
] as const;

// Hard-coded refs so the guard cannot be tricked by environment drift. The
// service-role key comes only from the operator env — never committed here.
const PREVIEW_REF = "obirkjbzpykoehxacaaj";
const PRODUCTION_REF = "nkkfsrhfttixwjbglhgg";
const ALLOWED_FLAGS = new Set(["--dry-run", "--apply", "--cleanup"]);

type Mode = "dry-run" | "apply" | "cleanup";

function resolveRef(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  const match = url.trim().match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/);
  return match?.[1] ?? null;
}

export function resolvePreviewDemoGuard(env: NodeJS.ProcessEnv):
  | { ok: true }
  | { ok: false; code: string } {
  const declaredRef = env.SUPABASE_PROJECT_REF?.trim();
  if (declaredRef !== PREVIEW_REF) return { ok: false, code: "SUPABASE_PROJECT_REF_NOT_PREVIEW" };

  const resolvedRef = resolveRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!resolvedRef) return { ok: false, code: "SUPABASE_URL_UNRESOLVED" };
  if (resolvedRef === PRODUCTION_REF) return { ok: false, code: "REFUSING_PRODUCTION" };
  if (resolvedRef !== PREVIEW_REF) return { ok: false, code: "SUPABASE_URL_NOT_PREVIEW" };

  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return { ok: false, code: "MISSING_SERVICE_ROLE_KEY" };
  return { ok: true };
}

function parseMode(args: string[]): Mode | { error: string } {
  const unknown = args.find((arg) => arg.startsWith("--") && !ALLOWED_FLAGS.has(arg));
  if (unknown) return { error: "UNKNOWN_FLAG" };
  if (args.includes("--cleanup") && (args.includes("--apply") || args.includes("--dry-run"))) {
    return { error: "CONFLICTING_FLAGS" };
  }
  if (args.includes("--cleanup")) return "cleanup";
  if (args.includes("--apply")) return "apply";
  return "dry-run";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = parseMode(args);
  if (typeof mode !== "string") {
    console.error(`[PreviewDemo] failed code=${mode.error}`);
    process.exitCode = 1;
    return;
  }

  const guard = resolvePreviewDemoGuard(process.env);
  if (!guard.ok) {
    console.error(`[PreviewDemo] refused code=${guard.code}`);
    process.exitCode = 1;
    return;
  }

  const dataset = buildPreviewDemoDataset();

  if (mode === "dry-run") {
    const distribution = dataset.emails.reduce<Record<string, number>>((acc, row) => {
      acc[row.classification_status] = (acc[row.classification_status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`[PreviewDemo] dry-run marker=${dataset.marker}`);
    console.log(`[PreviewDemo] would insert emails=${dataset.emails.length} checkpoint=1`);
    console.log(`[PreviewDemo] status distribution=${JSON.stringify(distribution)}`);
    console.log(`[PreviewDemo] deadline_tomorrow=${dataset.emails.filter((r) => r.deadline).length}`);
    return;
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Cleanup is scoped strictly to the marker — never touches unrelated rows.
  const removedEmails = await supabase
    .from("zoho_email_metadata")
    .delete()
    .eq(PREVIEW_DEMO_EMAIL_CLEANUP.column, PREVIEW_DEMO_EMAIL_CLEANUP.value)
    .select("id");
  if (removedEmails.error) {
    console.error("[PreviewDemo] failed code=EMAIL_DELETE_FAILED");
    process.exitCode = 1;
    return;
  }
  // The checkpoint delete requires BOTH the marker and the synthetic mailbox.
  let checkpointDelete = supabase.from("zoho_sync_checkpoints").delete();
  for (const filter of PREVIEW_DEMO_CHECKPOINT_CLEANUP) {
    checkpointDelete = checkpointDelete.eq(filter.column, filter.value);
  }
  const removedCheckpoint = await checkpointDelete.select("mailbox_email");
  if (removedCheckpoint.error) {
    console.error("[PreviewDemo] failed code=CHECKPOINT_DELETE_FAILED");
    process.exitCode = 1;
    return;
  }

  if (mode === "cleanup") {
    console.log(
      `[PreviewDemo] cleanup removed emails=${removedEmails.data?.length ?? 0} checkpoint=${removedCheckpoint.data?.length ?? 0}`,
    );
    return;
  }

  // apply: marker rows already cleared above, so re-running is idempotent.
  const insertedEmails = await supabase.from("zoho_email_metadata").insert(dataset.emails).select("id");
  if (insertedEmails.error || !insertedEmails.data) {
    console.error("[PreviewDemo] failed code=EMAIL_INSERT_FAILED");
    process.exitCode = 1;
    return;
  }
  const insertedCheckpoint = await supabase.from("zoho_sync_checkpoints").insert(dataset.checkpoint).select("mailbox_email");
  if (insertedCheckpoint.error || !insertedCheckpoint.data) {
    console.error("[PreviewDemo] failed code=CHECKPOINT_INSERT_FAILED");
    process.exitCode = 1;
    return;
  }

  console.log(
    `[PreviewDemo] apply inserted emails=${insertedEmails.data.length} checkpoint=${insertedCheckpoint.data.length} marker=${PREVIEW_DEMO_MARKER} checkpoint_mailbox=${PREVIEW_DEMO_CHECKPOINT_MAILBOX}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("[PreviewDemo] failed code=UNKNOWN_ERROR");
    process.exitCode = 1;
  });
}
