import { redactSensitivePatterns } from "@/lib/classify/redactionPatterns";
import type { EmailCategory } from "@/lib/classify/types";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

const VALID_CATEGORIES: readonly EmailCategory[] = [
  "application_received",
  "assessment",
  "interview_invite",
  "rejection",
  "job_offer",
  "recruiter_reply",
  "follow_up_needed",
  "otp_verification",
  "email_verification",
  "account_created",
  "system_notification",
  "spam_or_irrelevant",
  "unknown",
];

export type ReviewDecision = "confirm" | "change_category" | "send_to_review";

export interface SubmitReviewInput {
  id: string;
  decision: ReviewDecision;
  newCategory?: string;
  correctionReason?: string;
  reviewedBy: string;
}

export type SubmitReviewResult =
  | { ok: true }
  | { ok: false; code: "INVALID_CATEGORY" | "ROW_NOT_FOUND" | "SUPABASE_FAILED" };

export async function submitReviewDecision(input: SubmitReviewInput): Promise<SubmitReviewResult> {
  if (input.decision === "change_category") {
    if (!input.newCategory || !VALID_CATEGORIES.includes(input.newCategory as EmailCategory)) {
      return { ok: false, code: "INVALID_CATEGORY" };
    }
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data: row, error: rowError } = await supabase
    .from("zoho_email_metadata")
    .select("id, category, classification_status")
    .eq("id", input.id)
    .maybeSingle();

  if (rowError || !row) return { ok: false, code: "ROW_NOT_FOUND" };

  const typedRow = row as { id: string; category: string };
  const nowIso = new Date().toISOString();

  const payload: Record<string, unknown> = {
    reviewed_by: input.reviewedBy,
    reviewed_at: nowIso,
    updated_at: nowIso,
  };

  if (input.correctionReason) {
    payload.correction_reason = redactSensitivePatterns(input.correctionReason);
  }

  if (input.decision === "confirm") {
    payload.human_category = typedRow.category;
    payload.classification_status = "classified";
  } else if (input.decision === "change_category") {
    payload.human_category = input.newCategory;
    payload.classification_status = "classified";
  } else {
    payload.classification_status = "review";
  }

  const { error: updateError } = await supabase
    .from("zoho_email_metadata")
    .update(payload)
    .eq("id", input.id);

  if (updateError) return { ok: false, code: "SUPABASE_FAILED" };

  return { ok: true };
}
