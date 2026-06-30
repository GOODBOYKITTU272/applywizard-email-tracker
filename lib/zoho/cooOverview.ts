import "server-only";

import { sanitizeReason } from "@/lib/classify/sanitizeReason";
import type { EmailCategory } from "@/lib/classify/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const IMPORTANT_CATEGORIES = [
  "job_offer",
  "interview_invite",
  "assessment",
  "recruiter_reply",
  "follow_up_needed",
] as const;

const QUEUE_STATUSES = [
  "pending",
  "processing",
  "retry_scheduled",
  "review",
  "dead_letter",
] as const;

const MAX_ACTIVITY_ITEMS = 8;
const SAFE_REASON_FALLBACK = "Classification reason redacted for safety.";
const ACTIVITY_PRIORITY = {
  job_offer: 1,
  interview_invite: 2,
  assessment: 3,
  recruiter_reply: 4,
  follow_up_needed: 5,
  review: 6,
  other: 7,
} as const;

export interface OverviewMetrics {
  emailsReceivedToday: number;
  applicationReceivedToday: number;
  interviewInviteToday: number;
  assessmentToday: number;
  jobOfferToday: number;
  rejectionToday: number;
  recruiterReplyToday: number;
  followUpNeededToday: number;
  classifiedToday: number;
  needsReview: number;
}

export interface OverviewQueueMetrics {
  pending: number;
  processing: number;
  retryScheduled: number;
  review: number;
  deadLetter: number;
  oldestBacklogAgeMinutes: number | null;
  latestSuccessfulIngestAt: string | null;
}

export interface OverviewActivityItem {
  id: string;
  originalRecipient: string | null;
  category: EmailCategory | null;
  classificationStatus: "classified" | "review" | string;
  priority: "critical" | "high" | "normal" | "low" | "review";
  confidence: number | null;
  receivedAt: string;
  deadline: string | null;
  actionRequired: string | null;
  safeReason: string | null;
}

export interface OverviewDashboardData {
  metrics: OverviewMetrics;
  queue: OverviewQueueMetrics;
  importantActivity: OverviewActivityItem[];
}

interface EmailRow {
  id: string;
  original_recipient: string | null;
  category: EmailCategory | string | null;
  classification_status: string | null;
  confidence: number | null;
  received_at: string | null;
  classified_at: string | null;
  deadline: string | null;
  action_required: string | null;
  reason: string | null;
}

interface QueryBuilderLike {
  eq(column: string, value: unknown): QueryBuilderLike;
  gte(column: string, value: unknown): QueryBuilderLike;
  lt(column: string, value: unknown): QueryBuilderLike;
  in(column: string, values: unknown[]): QueryBuilderLike;
  order(column: string, opts?: { ascending?: boolean }): QueryBuilderLike;
  limit(count: number): Promise<{ data: EmailRow[] | null; error: { message: string } | null }>;
  maybeSingle(): Promise<{ data: { last_successful_sync_at?: string | null } | null; error: { message: string } | null }>;
  then?<T>(onfulfilled: (value: { count?: number; error: { message: string } | null }) => T): Promise<T>;
}

interface SupabaseLike {
  from(table: string): {
    select(columns: string, options?: { count?: string; head?: boolean }): QueryBuilderLike;
  };
}

function startOfUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function endOfUtcDay(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function minutesBetween(now: Date, previousIso: string | null): number | null {
  if (!previousIso) return null;
  const previous = new Date(previousIso);
  if (Number.isNaN(previous.getTime())) return null;
  const delta = Math.max(0, now.getTime() - previous.getTime());
  return Math.floor(delta / 60000);
}

function formatBacklogAge(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}m`;
}

function priorityRank(row: EmailRow): number {
  if (row.classification_status === "review") return 6;
  switch (row.category) {
    case "job_offer":
      return 1;
    case "interview_invite":
      return 2;
    case "assessment":
      return 3;
    case "recruiter_reply":
      return 4;
    case "follow_up_needed":
      return 5;
    default:
      return 7;
  }
}

function activitySortRank(row: EmailRow): number {
  switch (row.category) {
    case "job_offer":
      return 1;
    case "interview_invite":
      return 2;
    case "assessment":
      return 3;
    case "recruiter_reply":
    case "follow_up_needed":
      return 4;
    default:
      return row.classification_status === "review" ? 5 : 6;
  }
}

function activityPriorityLabel(row: EmailRow): OverviewActivityItem["priority"] {
  if (row.classification_status === "review") return "review";
  const rank = priorityRank(row);
  if (rank === ACTIVITY_PRIORITY.job_offer) return "critical";
  if (rank <= ACTIVITY_PRIORITY.follow_up_needed) return "high";
  return "normal";
}

function normalizeActivityRow(row: EmailRow): OverviewActivityItem | null {
  if (!row.id || !row.received_at) return null;
  const category = row.category && typeof row.category === "string" ? (row.category as EmailCategory) : null;
  const classificationStatus = row.classification_status ?? "classified";
  const safeReason =
    classificationStatus === "review"
      ? sanitizeReason(row.reason ?? SAFE_REASON_FALLBACK)
      : null;

  return {
    id: row.id,
    originalRecipient: row.original_recipient ?? null,
    category,
    classificationStatus,
    priority: activityPriorityLabel(row),
    confidence: row.confidence ?? null,
    receivedAt: row.received_at,
    deadline: row.deadline ?? null,
    actionRequired: row.action_required ?? null,
    safeReason,
  };
}

async function countRows(
  supabase: SupabaseLike,
  build: (query: QueryBuilderLike) => QueryBuilderLike,
): Promise<number> {
  const query = build(
    supabase.from("zoho_email_metadata").select("*", { count: "exact", head: true }),
  );
  const { count, error } = await (query as PromiseLike<{
    count?: number;
    error: { message: string } | null;
  }>);
  if (error) {
    console.error("[Overview] Count query failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

async function fetchRows(
  supabase: SupabaseLike,
  build: (query: QueryBuilderLike) => QueryBuilderLike,
): Promise<EmailRow[]> {
  const query = build(
    supabase.from("zoho_email_metadata").select(
      "id,original_recipient,category,classification_status,confidence,received_at,classified_at,deadline,action_required,reason",
    ),
  );
  const result = await query.limit(MAX_ACTIVITY_ITEMS * 2);
  if (result.error) {
    console.error("[Overview] Fetch query failed:", result.error.message);
    return [];
  }
  return (result.data ?? []) as EmailRow[];
}

async function getLatestSuccessfulIngestAt(
  supabase: SupabaseLike,
  mailboxEmail: string,
): Promise<string | null> {
  const readCheckpoint = async (filtered: boolean) => {
    let query = supabase
      .from("zoho_sync_checkpoints")
      .select("last_successful_sync_at")
      .order("last_successful_sync_at", { ascending: false });

    if (filtered) {
      query = query.eq("mailbox_email", mailboxEmail);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      return null;
    }

    const checkpointRow = Array.isArray(data) ? data[0] : data;
    return toIsoDate(checkpointRow?.last_successful_sync_at ?? null);
  };

  const scoped = await readCheckpoint(true);
  if (scoped) return scoped;

  const unscoped = await readCheckpoint(false);
  if (unscoped) return unscoped;

  const { error } = await supabase
    .from("zoho_sync_checkpoints")
    .select("last_successful_sync_at")
    .eq("mailbox_email", mailboxEmail)
    .order("last_successful_sync_at", { ascending: false })
    .maybeSingle();

  if (error) {
    console.error("[Overview] Checkpoint query failed:", error.message);
  }

  return null;
}

export async function getOverviewDashboardData(args?: {
  supabase?: SupabaseLike;
  now?: Date;
  mailboxEmail?: string;
}): Promise<OverviewDashboardData> {
  const supabase = args?.supabase ?? (createSupabaseServerClient() as unknown as SupabaseLike);
  const now = args?.now ?? new Date();
  const mailboxEmail = args?.mailboxEmail ?? process.env.ZOHO_SYNC_MAILBOX ?? "tracker@applywizard.ai";
  const startIso = startOfUtcDay(now);
  const endIso = endOfUtcDay(now);

  const [receivedTodayRows, classifiedTodayRows] = await Promise.all([
    fetchRows(supabase, (q) => q.gte("received_at", startIso).lt("received_at", endIso)),
    fetchRows(supabase, (q) =>
      q.gte("classified_at", startIso).lt("classified_at", endIso),
    ),
  ]);
  const todayRowsById = new Map<string, EmailRow>();
  for (const row of [...receivedTodayRows, ...classifiedTodayRows]) {
    if (!row?.id) continue;
    todayRowsById.set(row.id, row);
  }
  const todayRows = [...todayRowsById.values()];

  const [
    emailsReceivedToday,
    pending,
    processing,
    retryScheduled,
    review,
    deadLetter,
  ] = await Promise.all([
    countRows(supabase, (q) => q.gte("received_at", startIso).lt("received_at", endIso)),
    countRows(supabase, (q) => q.eq("classification_status", "pending")),
    countRows(supabase, (q) => q.eq("classification_status", "processing")),
    countRows(supabase, (q) => q.eq("classification_status", "retry_scheduled")),
    countRows(supabase, (q) => q.eq("classification_status", "review")),
    countRows(supabase, (q) => q.eq("classification_status", "dead_letter")),
  ]);

  const applicationReceivedToday = todayRows.filter(
    (row) => row.category === "application_received",
  ).length;
  const classifiedToday = todayRows.filter((row) => {
    if (row.classification_status === "review") {
      return row.category === "unknown";
    }
    return (
      row.classification_status === "classified" &&
      (row.category === "job_offer" ||
        row.category === "interview_invite" ||
        row.category === "assessment" ||
        row.category === "recruiter_reply" ||
        row.category === "follow_up_needed")
    );
  }).length;
  const interviewInviteToday = todayRows.filter((row) => row.category === "interview_invite").length;
  const assessmentToday = todayRows.filter((row) => row.category === "assessment").length;
  const jobOfferToday = todayRows.filter((row) => row.category === "job_offer").length;
  const rejectionToday = todayRows.filter((row) => row.category === "rejection").length;
  const recruiterReplyToday = todayRows.filter((row) => row.category === "recruiter_reply").length;
  const followUpNeededToday = todayRows.filter((row) => row.category === "follow_up_needed").length;

  const oldestBacklogQuery = supabase
    .from("zoho_email_metadata")
    .select("received_at")
    .in("classification_status", [...QUEUE_STATUSES.filter((status) => status !== "dead_letter")])
    .order("received_at", { ascending: true });
  const oldestBacklogResult = await oldestBacklogQuery.limit(1);
  const oldestBacklogReceivedAt = oldestBacklogResult.error
    ? null
    : oldestBacklogResult.data?.[0]?.received_at ?? null;

  const [importantRows, latestSuccessfulIngestAt] = await Promise.all([
    Promise.all([
      fetchRows(supabase, (q) =>
        q.gte("received_at", startIso)
          .lt("received_at", endIso)
          .in("category", [...IMPORTANT_CATEGORIES]),
      ),
      fetchRows(supabase, (q) =>
        q.gte("received_at", startIso)
          .lt("received_at", endIso)
          .eq("classification_status", "review"),
      ),
    ]).then(([highSignalRows, reviewRowsOnly]) => {
      const merged = new Map<string, EmailRow>();
      for (const row of [...highSignalRows, ...reviewRowsOnly]) {
        if (!row?.id) continue;
        merged.set(row.id, row);
      }
      return [...merged.values()];
    }),
    getLatestSuccessfulIngestAt(supabase, mailboxEmail),
  ]);

  const activityRankById = new Map(
    importantRows.map((row) => [row.id, activitySortRank(row)] as const),
  );

  const importantActivity = importantRows
    .map((row) => normalizeActivityRow(row))
    .filter((row): row is OverviewActivityItem => Boolean(row))
    .sort((left, right) => {
      const leftRank = activityRankById.get(left.id) ?? 6;
      const rightRank = activityRankById.get(right.id) ?? 6;
      const priorityDiff = leftRank - rightRank;
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime();
    })
    .slice(0, MAX_ACTIVITY_ITEMS);

  const metrics: OverviewMetrics = {
    emailsReceivedToday,
    applicationReceivedToday,
    interviewInviteToday,
    assessmentToday,
    jobOfferToday,
    rejectionToday,
    recruiterReplyToday,
    followUpNeededToday,
    classifiedToday,
    needsReview: review,
  };

  const queue: OverviewQueueMetrics = {
    pending,
    processing,
    retryScheduled,
    review,
    deadLetter,
    oldestBacklogAgeMinutes: minutesBetween(now, oldestBacklogReceivedAt),
    latestSuccessfulIngestAt,
  };

  return {
    metrics,
    queue,
    importantActivity,
  };
}

export { formatBacklogAge, startOfUtcDay, endOfUtcDay };
