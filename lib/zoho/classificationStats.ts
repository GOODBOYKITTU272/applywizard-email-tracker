/**
 * Safe server-side classification observability helper.
 * Returns only aggregate counts — never email bodies, subjects, or OTP values.
 */
import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ClassificationStats {
  pending_count: number;
  processing_count: number;
  retry_scheduled_count: number;
  classified_count: number;
  review_count: number;
  dead_letter_count: number;
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
    pending_count,
    processing_count,
    retry_scheduled_count,
    classified_count,
    review_count,
    dead_letter_count,
    total_classified,
    deterministic_count,
    regex_count,
    ai_count,
    unknown_count,
    review_required_count,
    system_notification_count,
    spam_or_irrelevant_count,
  ] = await Promise.all([
    countWhere(supabase, { classification_status: "pending" }),
    countWhere(supabase, { classification_status: "processing" }),
    countWhere(supabase, { classification_status: "retry_scheduled" }),
    countWhere(supabase, { classification_status: "classified" }),
    countWhere(supabase, { classification_status: "review" }),
    countWhere(supabase, { classification_status: "dead_letter" }),
    countWhere(supabase, { classification_status: "classified" }),
    countWhere(supabase, { classification_status: "classified", classifier_source: "deterministic" }),
    countWhere(supabase, { classification_status: "classified", classifier_source: "regex" }),
    countWhere(supabase, { classification_status: "classified", classifier_source: "ai" }),
    countWhere(supabase, { classification_status: "classified", category: "unknown" }),
    countWhere(supabase, { classification_status: "review" }),
    countWhere(supabase, { classification_status: "classified", category: "system_notification" }),
    countWhere(supabase, { classification_status: "classified", category: "spam_or_irrelevant" }),
  ]);

  return {
    pending_count,
    processing_count,
    retry_scheduled_count,
    classified_count,
    review_count,
    dead_letter_count,
    total_classified,
    deterministic_count,
    regex_count,
    ai_count,
    unknown_count,
    review_required_count,
    system_notification_count,
    spam_or_irrelevant_count,
    errors_count: dead_letter_count,
  };
}
