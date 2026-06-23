/**
 * Safe server-side classification observability helper.
 * Returns only aggregate counts — never email bodies, subjects, or OTP values.
 */
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ClassificationStats {
  total_classified: number;
  deterministic_count: number;
  regex_count: number;
  ai_count: number;
  unknown_count: number;
  review_required_count: number;
  system_notification_count: number;
  spam_or_irrelevant_count: number;
  errors_count: number;
}

async function countWhere(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  filters: Record<string, string | boolean>,
): Promise<number> {
  let q = supabase.from("zoho_email_metadata").select("*", { count: "exact", head: true });
  for (const [col, val] of Object.entries(filters)) {
    q = q.eq(col, val);
  }
  const { count, error } = await q;
  if (error) {
    console.error("[ClassificationStats] Count query failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function getClassificationStats(): Promise<ClassificationStats> {
  const supabase = createSupabaseServerClient();

  const [
    total_classified,
    deterministic_count,
    regex_count,
    ai_count,
    unknown_count,
    review_required_count,
    system_notification_count,
    spam_or_irrelevant_count,
    errors_count,
  ] = await Promise.all([
    countWhere(supabase, { classification_status: "classified" }),
    countWhere(supabase, { classification_status: "classified", classifier_source: "deterministic" }),
    countWhere(supabase, { classification_status: "classified", classifier_source: "regex" }),
    countWhere(supabase, { classification_status: "classified", classifier_source: "ai" }),
    countWhere(supabase, { classification_status: "classified", category: "unknown" }),
    countWhere(supabase, { classification_status: "classified", needs_human_review: true }),
    countWhere(supabase, { classification_status: "classified", category: "system_notification" }),
    countWhere(supabase, { classification_status: "classified", category: "spam_or_irrelevant" }),
    countWhere(supabase, { classification_status: "failed" }),
  ]);

  return {
    total_classified,
    deterministic_count,
    regex_count,
    ai_count,
    unknown_count,
    review_required_count,
    system_notification_count,
    spam_or_irrelevant_count,
    errors_count,
  };
}
