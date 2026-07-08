import { randomUUID } from "crypto";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

export const RELEASE_BATCH_SIZE = 100;

export interface ReleaseOptions {
  mailbox: string;
  dryRun: boolean;
  confirmProductionRelease?: boolean;
}

export type ReleaseErrorCode =
  | "RELEASE_CONFIG_INVALID"
  | "RELEASE_CONFIRMATION_REQUIRED"
  | "RELEASE_SUPABASE_FAILED"
  | "RELEASE_UNKNOWN_ERROR";

export type ReleaseResult =
  | { ok: true; dryRun: true; eligibleCount: number }
  | { ok: true; dryRun: false; batchId: string; releasedCount: number }
  | { ok: false; code: ReleaseErrorCode };

export function optionsFromEnv(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ReleaseOptions {
  return {
    mailbox: env.ZOHO_SYNC_MAILBOX?.toLowerCase().trim() ?? "",
    dryRun: !args.includes("--confirm-production-release"),
    confirmProductionRelease: args.includes("--confirm-production-release"),
  };
}

interface SupabaseLike {
  rpc(
    fn: string,
    params: Record<string, unknown>,
  ): Promise<{ data: string[] | null; error: { message: string } | null }>;
  from(table: string): {
    select(columns: string, opts?: { count?: string; head?: boolean }): {
      eq(
        column: string,
        value: unknown,
      ): Promise<{ count: number | null; error: { message: string } | null }>;
    };
    insert(
      row: Record<string, unknown>,
    ): Promise<{ error: { message: string } | null }>;
  };
}

function releaseFailure(code: ReleaseErrorCode): ReleaseResult {
  return { ok: false, code };
}

export async function runHistoricalRelease(
  options: ReleaseOptions,
): Promise<ReleaseResult> {
  if (!options.mailbox) {
    return releaseFailure("RELEASE_CONFIG_INVALID");
  }

  const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;

  try {
    if (options.dryRun) {
      const { count, error } = await supabase
        .from("zoho_email_metadata")
        .select("id", { count: "exact", head: true })
        .eq("classification_status", "historical_ingested");

      if (error) {
        return releaseFailure("RELEASE_SUPABASE_FAILED");
      }

      return { ok: true, dryRun: true, eligibleCount: count ?? 0 };
    }

    if (!options.confirmProductionRelease) {
      return releaseFailure("RELEASE_CONFIRMATION_REQUIRED");
    }

    const batchId = randomUUID();
    const { data, error } = await supabase.rpc("release_historical_batch", {
      p_mailbox_email: options.mailbox,
      p_batch_id: batchId,
      p_limit: RELEASE_BATCH_SIZE,
    });

    if (error) {
      return releaseFailure("RELEASE_SUPABASE_FAILED");
    }

    const releasedCount = Array.isArray(data) ? data.length : 0;

    const { error: insertError } = await supabase.from("zoho_release_batches").insert({
      id: batchId,
      mailbox_email: options.mailbox,
      requested_size: RELEASE_BATCH_SIZE,
      released_count: releasedCount,
      dry_run: false,
    });

    if (insertError) {
      return releaseFailure("RELEASE_SUPABASE_FAILED");
    }

    return { ok: true, dryRun: false, batchId, releasedCount };
  } catch {
    return releaseFailure("RELEASE_UNKNOWN_ERROR");
  }
}
