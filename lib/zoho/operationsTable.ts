import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const INTERVIEWS_PAGE_SIZE = 50;

const INTERVIEW_COLUMNS = [
  "id",
  "original_recipient",
  "received_at",
  "category",
  "confidence",
  "priority",
  "deadline",
  "action_required",
  "reason",
  "company_name",
  "job_title",
  "classification_status",
  "human_category",
  "reviewed_by",
  "reviewed_at",
  "correction_reason",
].join(",");

export interface InterviewRow {
  id: string;
  original_recipient: string | null;
  received_at: string | null;
  category: string | null;
  confidence: number | null;
  priority: string | null;
  deadline: string | null;
  action_required: string | null;
  reason: string | null;
  company_name: string | null;
  job_title: string | null;
  classification_status: string | null;
  human_category: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  correction_reason: string | null;
}

export interface InterviewFilters {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
}

export type GetInterviewRowsResult =
  | { ok: true; rows: InterviewRow[]; totalCount: number; page: number; pageSize: number }
  | { ok: false };

export type GetInterviewByIdResult =
  | { ok: true; row: InterviewRow }
  | { ok: false };

interface SupabaseQuery {
  eq(column: string, value: unknown): SupabaseQuery;
  neq(column: string, value: unknown): SupabaseQuery;
  gte(column: string, value: unknown): SupabaseQuery;
  lte(column: string, value: unknown): SupabaseQuery;
  or(filters: string): SupabaseQuery;
  range(start: number, end: number): SupabaseQuery;
  maybeSingle(): SupabaseQuery;
  then(resolve: (value: { data: InterviewRow[] | InterviewRow | null; error: { message: string } | null; count?: number }) => void): Promise<void>;
}

interface SupabaseLike {
  from(table: string): {
    select(columns: string, options?: { count?: string; head?: boolean }): SupabaseQuery;
  };
}

function sanitizePage(value: number | undefined): number {
  return value && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export async function getInterviewRows(filters: InterviewFilters = {}): Promise<GetInterviewRowsResult> {
  const page = sanitizePage(filters.page);
  const from = (page - 1) * INTERVIEWS_PAGE_SIZE;
  const to = from + INTERVIEWS_PAGE_SIZE - 1;

  try {
    const supabase = createSupabaseServerClient() as unknown as SupabaseLike;
    let query = supabase
      .from("zoho_email_metadata")
      .select(INTERVIEW_COLUMNS, { count: "exact" })
      .eq("category", "interview_invite")
      .neq("classification_status", "dead_letter");

    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.or(
        `original_recipient.ilike.${term},company_name.ilike.${term},job_title.ilike.${term}`,
      );
    }

    if (filters.dateFrom) {
      query = query.gte("received_at", filters.dateFrom);
    }

    if (filters.dateTo) {
      query = query.lte("received_at", filters.dateTo);
    }

    const { data, error, count } = await query.range(from, to);

    if (error) {
      console.error("[Operations Table] Interview rows query failed:", error.message);
      return { ok: false };
    }

    return {
      ok: true,
      rows: (data ?? []) as InterviewRow[],
      totalCount: count ?? 0,
      page,
      pageSize: INTERVIEWS_PAGE_SIZE,
    };
  } catch (error) {
    console.error(
      "[Operations Table] Interview rows query threw:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false };
  }
}

export async function getInterviewById(id: string): Promise<GetInterviewByIdResult> {
  try {
    const supabase = createSupabaseServerClient() as unknown as SupabaseLike;
    const { data, error } = await supabase
      .from("zoho_email_metadata")
      .select(INTERVIEW_COLUMNS)
      .eq("id", id)
      .eq("category", "interview_invite")
      .neq("classification_status", "dead_letter")
      .maybeSingle();

    if (error) {
      console.error("[Operations Table] Interview row query failed:", error.message);
      return { ok: false };
    }

    if (!data) {
      return { ok: false };
    }

    return { ok: true, row: data as InterviewRow };
  } catch (error) {
    console.error(
      "[Operations Table] Interview row query threw:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false };
  }
}
