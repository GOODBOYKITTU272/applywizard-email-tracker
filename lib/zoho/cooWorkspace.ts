import "server-only";

import { sanitizeReason, SAFE_REASON_FALLBACK } from "@/lib/classify/sanitizeReason";
import type { EmailCategory, Priority } from "@/lib/classify/types";
import type { QueueStatus } from "@/lib/zoho/queueFoundation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SAFE_EMAIL_COLUMNS = [
  "id",
  "original_recipient",
  "category",
  "classification_status",
  "confidence",
  "priority",
  "received_at",
  "first_seen_at",
  "created_at",
  "classified_at",
  "deadline",
  "action_required",
  "reason",
  "next_retry_at",
  "dead_lettered_at",
  "claim_expires_at",
  "last_error_code",
  "routing_status",
  "email_direction",
].join(",");

const BUSINESS_CATEGORIES = [
  "application_received",
  "interview_invite",
  "assessment",
  "job_offer",
  "rejection",
  "recruiter_reply",
  "follow_up_needed",
] as const;

type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];

const IMPORTANT_CATEGORIES = [
  "job_offer",
  "interview_invite",
  "assessment",
  "recruiter_reply",
  "follow_up_needed",
] as const;

const DEFAULT_REVIEW_LIMIT = 50;
const DEFAULT_QUEUE_LIMIT = 25;
const DEFAULT_CLIENT_PAGE_LIMIT = 1000;
const DEAD_LETTER_LABEL = "Dead Letter";

export type DatePreset = "today" | "yesterday" | "last_7_days" | "last_30_days" | "custom";
export type StageFilter = "all" | "awaiting_classification" | "classified_activity";
export type QueueFilter = "all" | QueueStatus;
export type UrgencyFilter = "all" | "offers" | "interviews" | "assessments" | "review_needed";

export interface WorkspaceDateRange {
  preset: DatePreset;
  startIso: string;
  endIso: string;
  label: string;
  from?: string | null;
  to?: string | null;
}

export interface WorkspaceSearchParams {
  range?: string | null;
  from?: string | null;
  to?: string | null;
  stage?: StageFilter | string | null;
  deadline?: string | null;
  q?: string | null;
  urgency?: UrgencyFilter | string | null;
  queue?: QueueFilter | string | null;
}

export interface EmailRow {
  id: string;
  original_recipient: string | null;
  category: EmailCategory | string | null;
  classification_status: QueueStatus | string | null;
  confidence: number | null;
  priority: Priority | string | null;
  received_at: string | null;
  first_seen_at: string | null;
  created_at: string | null;
  classified_at: string | null;
  deadline: string | null;
  action_required: string | null;
  reason: string | null;
  next_retry_at: string | null;
  dead_lettered_at: string | null;
  claim_expires_at: string | null;
  last_error_code: string | null;
  routing_status: string | null;
  email_direction: string | null;
}

export interface WorkspaceMetrics {
  totalEmails: number;
  newEmails: number;
  classifiedToday: number;
  pendingClassification: number;
  pending: number;
  processing: number;
  retryScheduled: number;
  review: number;
  deadLetter: number;
  applications: number;
  interviews: number;
  assessments: number;
  offers: number;
  rejections: number;
  recruiterReplies: number;
  followUpNeeded: number;
  oldestBacklogAgeMinutes: number | null;
  latestSuccessfulIngestAt: string | null;
  currentProcessingCount: number;
}

export interface WorkspaceClientRow {
  clientKey: string;
  originalRecipient: string;
  totalEmails: number;
  newEmails: number;
  applications: number;
  interviews: number;
  assessments: number;
  offers: number;
  rejections: number;
  recruiterReplies: number;
  followUpNeeded: number;
  reviewCount: number;
  pendingCount: number;
  processingCount: number;
  retryScheduledCount: number;
  deadLetterCount: number;
  latestMeaningfulCategory: EmailCategory | "unknown" | null;
  latestMeaningfulReceivedAt: string | null;
  latestMeaningfulQueueStatus: QueueStatus | null;
  latestMeaningfulPriority: Priority | "review" | null;
  latestMeaningfulConfidence: number | null;
  latestMeaningfulDeadline: string | null;
  latestMeaningfulActionRequired: string | null;
  queueState: string;
  queueStateCount: number;
  urgency: "offer" | "interview" | "assessment" | "review required" | "other";
  urgencyRank: number;
  queueRiskRank: number;
  latestUpdateLabel: string;
  hasDeadlineTomorrow: boolean;
}

export interface WorkspaceActivityRow {
  id: string;
  clientKey: string;
  originalRecipient: string | null;
  category: EmailCategory | null;
  classificationStatus: QueueStatus | null;
  priority: WorkspaceClientRow["urgency"] | "review";
  confidence: number | null;
  receivedAt: string;
  deadline: string | null;
  actionRequired: string | null;
  safeReason: string | null;
  queueAgeMinutes: number | null;
  queueStatusLabel: string;
}

export interface WorkspaceTimelineRow {
  id: string;
  category: EmailCategory | "unknown" | null;
  classificationStatus: QueueStatus | null;
  priority: Priority | null;
  confidence: number | null;
  receivedAt: string;
  deadline: string | null;
  actionRequired: string | null;
  safeReason: string | null;
  queueAgeMinutes: number | null;
  queueStatusLabel: string;
  isPending: boolean;
  isReview: boolean;
}

export interface OverviewWorkspaceData {
  metrics: WorkspaceMetrics;
  clientRows: WorkspaceClientRow[];
  activityRows: WorkspaceActivityRow[];
  dateRange: WorkspaceDateRange;
  stageFilter: StageFilter;
  deadlineTomorrowOnly: boolean;
}

export interface ClientDetailData {
  clientKey: string;
  originalRecipient: string;
  dateRange: WorkspaceDateRange;
  summary: {
    totalEmails: number;
    newEmails: number;
    applications: number;
    interviews: number;
    assessments: number;
    offers: number;
    rejections: number;
    recruiterReplies: number;
    followUpNeeded: number;
    reviewCount: number;
    pendingCount: number;
    processingCount: number;
    retryScheduledCount: number;
    deadLetterCount: number;
    latestMeaningfulCategory: EmailCategory | "unknown" | null;
    latestMeaningfulReceivedAt: string | null;
    latestMeaningfulConfidence: number | null;
    latestMeaningfulDeadline: string | null;
    latestMeaningfulActionRequired: string | null;
    queueState: string;
    urgency: WorkspaceClientRow["urgency"];
  };
  timeline: WorkspaceTimelineRow[];
}

export interface OperationsListRow {
  id: string;
  originalRecipient: string | null;
  queueStatus: QueueStatus;
  receivedAt: string;
  queueAgeMinutes: number | null;
  queueAgeLabel: string;
  confidence: number | null;
  safeReason: string | null;
  deadline: string | null;
  actionRequired: string | null;
  lastErrorCode: string | null;
  nextRetryAt: string | null;
  deadLetteredAt: string | null;
}

export interface OperationsWorkspaceData {
  pending: number;
  processing: number;
  retryScheduled: number;
  review: number;
  deadLetter: number;
  oldestBacklogAgeMinutes: number | null;
  latestSuccessfulIngestAt: string | null;
  currentProcessingCount: number;
  oldestPending: OperationsListRow[];
  oldestReview: OperationsListRow[];
  retryScheduledRows: OperationsListRow[];
  deadLetterRows: OperationsListRow[];
}

export interface ReviewQueueRow {
  id: string;
  clientKey: string;
  originalRecipient: string | null;
  suggestedCategory: EmailCategory | "unknown" | null;
  confidence: number | null;
  safeReason: string | null;
  receivedAt: string;
  queueAgeMinutes: number | null;
  queueAgeLabel: string;
  deadline: string | null;
  actionRequired: string | null;
  queueStatusLabel: string;
}

export interface ReviewQueueWorkspaceData {
  rows: ReviewQueueRow[];
  count: number;
}

interface SupabaseLike {
  from(table: string): {
    select(columns: string, options?: { count?: string; head?: boolean }): SupabaseQuery;
    upsert?(...args: never[]): never;
  };
}

interface SupabaseQueryResult {
  data: EmailRow[] | null;
  error: { message: string } | null;
  count?: number;
}

interface SupabaseQuery {
  eq(column: string, value: unknown): SupabaseQuery;
  gte(column: string, value: unknown): SupabaseQuery;
  lt(column: string, value: unknown): SupabaseQuery;
  in(column: string, value: unknown[]): SupabaseQuery;
  order(column: string, opts?: { ascending?: boolean }): SupabaseQuery;
  range(start: number, end: number): SupabaseQuery;
  then(resolve: (value: SupabaseQueryResult) => void): Promise<void>;
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function startOfUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function endOfUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function addUtcDays(now: Date, days: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
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

function queueAgeTimestamp(row: Pick<EmailRow, "first_seen_at" | "created_at" | "received_at">): string | null {
  return toIsoDate(row.first_seen_at ?? row.created_at ?? row.received_at ?? null);
}

function isBusinessCategory(category: string | null | undefined): category is BusinessCategory {
  return Boolean(category && BUSINESS_CATEGORIES.includes(category as BusinessCategory));
}

function isImportantCategory(category: string | null | undefined): category is (typeof IMPORTANT_CATEGORIES)[number] {
  return Boolean(category && IMPORTANT_CATEGORIES.includes(category as (typeof IMPORTANT_CATEGORIES)[number]));
}

function resolveDateRange(args?: {
  now?: Date;
  range?: string | null;
  from?: string | null;
  to?: string | null;
}): WorkspaceDateRange {
  const now = args?.now ?? new Date();
  const preset = (args?.range ?? "today").toLowerCase();

  if (preset === "yesterday") {
    const start = addUtcDays(now, -1);
    const end = addUtcDays(now, 0);
    return {
      preset: "yesterday",
      startIso: startOfUtcDay(start),
      endIso: startOfUtcDay(end),
      label: "Yesterday",
    };
  }

  if (preset === "last_7_days" || preset === "7d") {
    const start = addUtcDays(now, -6);
    return {
      preset: "last_7_days",
      startIso: startOfUtcDay(start),
      endIso: endOfUtcDay(now),
      label: "Last 7 Days",
    };
  }

  if (preset === "last_30_days" || preset === "30d") {
    const start = addUtcDays(now, -29);
    return {
      preset: "last_30_days",
      startIso: startOfUtcDay(start),
      endIso: endOfUtcDay(now),
      label: "Last 30 Days",
    };
  }

  if (preset === "custom") {
    const from = args?.from ? new Date(args.from) : null;
    const to = args?.to ? new Date(args.to) : null;
    const safeFrom = from && !Number.isNaN(from.getTime()) ? from : addUtcDays(now, -6);
    const safeTo = to && !Number.isNaN(to.getTime()) ? to : now;
    return {
      preset: "custom",
      startIso: startOfUtcDay(safeFrom),
      endIso: endOfUtcDay(safeTo),
      from: args?.from ?? null,
      to: args?.to ?? null,
      label: "Custom Range",
    };
  }

  return {
    preset: "today",
    startIso: startOfUtcDay(now),
    endIso: endOfUtcDay(now),
    label: "Today",
  };
}

export function buildClientKey(originalRecipient: string): string {
  return `c_${Buffer.from(normalizeEmail(originalRecipient), "utf8").toString("base64url")}`;
}

export function resolveClientRecipient(clientKey: string): string | null {
  const encoded = clientKey.startsWith("c_") ? clientKey.slice(2) : clientKey;
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const normalized = normalizeEmail(decoded);
    return normalized || null;
  } catch {
    return null;
  }
}

function safeQueueStatusLabel(status: QueueStatus | string | null | undefined): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "processing":
      return "Processing";
    case "retry_scheduled":
      return "Retrying";
    case "classified":
      return "Classified";
    case "review":
      return "Review Queue";
    case "dead_letter":
      return DEAD_LETTER_LABEL;
    default:
      return "Unknown";
  }
}

function isQueueStatus(status: string | null | undefined): status is QueueStatus {
  return status === "pending" ||
    status === "processing" ||
    status === "retry_scheduled" ||
    status === "classified" ||
    status === "review" ||
    status === "dead_letter";
}

function priorityFromRow(row: EmailRow): WorkspaceClientRow["urgency"] {
  if (row.category === "job_offer") return "offer";
  if (row.category === "interview_invite") return "interview";
  if (row.category === "assessment") return "assessment";
  if (row.category === "recruiter_reply" || row.category === "follow_up_needed") return "review required";
  if (row.classification_status === "review") return "review required";
  return "other";
}

function urgencyRank(label: WorkspaceClientRow["urgency"]): number {
  switch (label) {
    case "offer":
      return 1;
    case "interview":
      return 2;
    case "assessment":
      return 3;
    case "review required":
      return 4;
    default:
      return 5;
  }
}

function queueRiskRank(row: EmailRow): number {
  if (row.classification_status === "dead_letter") return 5;
  if (row.classification_status === "review") return 4;
  if (row.classification_status === "retry_scheduled") return 3;
  if (row.classification_status === "processing") return 2;
  if (row.classification_status === "pending") return 1;
  return 0;
}

function toClientRowAggregate(
  rows: EmailRow[],
  now: Date,
  rangeStartIso: string,
  rangeEndIso: string,
): WorkspaceClientRow | null {
  const first = rows[0];
  const originalRecipient = normalizeEmail(first?.original_recipient);
  if (!originalRecipient) return null;
  if (normalizeEmail(process.env.ZOHO_SYNC_MAILBOX ?? "tracker@applywizard.ai") === originalRecipient) {
    return null;
  }

  let totalEmails = 0;
  let newEmails = 0;
  let applications = 0;
  let interviews = 0;
  let assessments = 0;
  let offers = 0;
  let rejections = 0;
  let recruiterReplies = 0;
  let followUpNeeded = 0;
  let reviewCount = 0;
  let pendingCount = 0;
  let processingCount = 0;
  let retryScheduledCount = 0;
  let deadLetterCount = 0;
  let latestMeaningfulRow: EmailRow | null = null;
  let bestUrgency: WorkspaceClientRow["urgency"] = "other";
  let bestUrgencyRank = Number.POSITIVE_INFINITY;
  let queueRiskScore = 0;
  const tomorrowIso = formatTomorrowIso(now);

  for (const row of rows) {
    totalEmails += 1;
    if (row.first_seen_at && row.first_seen_at >= rangeStartIso && row.first_seen_at < rangeEndIso) {
      newEmails += 1;
    }

    const isDeadLetter = row.classification_status === "dead_letter";

    if (!isDeadLetter && row.category === "application_received") applications += 1;
    if (!isDeadLetter && row.category === "interview_invite") interviews += 1;
    if (!isDeadLetter && row.category === "assessment") assessments += 1;
    if (!isDeadLetter && row.category === "job_offer") offers += 1;
    if (!isDeadLetter && row.category === "rejection") rejections += 1;
    if (!isDeadLetter && row.category === "recruiter_reply") recruiterReplies += 1;
    if (!isDeadLetter && row.category === "follow_up_needed") followUpNeeded += 1;

    if (row.classification_status === "review") reviewCount += 1;
    if (row.classification_status === "pending") pendingCount += 1;
    if (row.classification_status === "processing") processingCount += 1;
    if (row.classification_status === "retry_scheduled") retryScheduledCount += 1;
    if (row.classification_status === "dead_letter") deadLetterCount += 1;

    if (
      row.classification_status &&
      ["classified", "review"].includes(row.classification_status) &&
      (isBusinessCategory(row.category) || row.classification_status === "review")
    ) {
      if (!latestMeaningfulRow) {
        latestMeaningfulRow = row;
      } else if (
        (row.received_at ?? "") > (latestMeaningfulRow.received_at ?? "")
      ) {
        latestMeaningfulRow = row;
      }
    }

    const urgency = priorityFromRow(row);
    const rank = urgencyRank(urgency);
    if (rank < bestUrgencyRank) {
      bestUrgencyRank = rank;
      bestUrgency = urgency;
    }

    queueRiskScore += queueRiskRank(row);
  }

  const latestMeaningfulCategory = latestMeaningfulRow?.category && isBusinessCategory(latestMeaningfulRow.category)
    ? latestMeaningfulRow.category
    : latestMeaningfulRow?.classification_status === "review"
      ? "unknown"
      : null;

  const latestMeaningfulReceivedAt = latestMeaningfulRow?.received_at ?? null;
  const latestMeaningfulConfidence = latestMeaningfulRow?.confidence ?? null;
  const latestMeaningfulDeadline = latestMeaningfulRow?.deadline ?? null;
  const latestMeaningfulActionRequired = latestMeaningfulRow?.action_required ?? null;

  const queueState =
    deadLetterCount > 0
      ? DEAD_LETTER_LABEL
      : reviewCount > 0
        ? "Review Queue"
        : retryScheduledCount > 0
          ? "Retrying"
          : processingCount > 0
            ? "Processing"
            : pendingCount > 0
              ? "Pending"
              : "All Clear";

  return {
    clientKey: buildClientKey(originalRecipient),
    originalRecipient,
    totalEmails,
    newEmails,
    applications,
    interviews,
    assessments,
    offers,
    rejections,
    recruiterReplies,
    followUpNeeded,
    reviewCount,
    pendingCount,
    processingCount,
    retryScheduledCount,
    deadLetterCount,
    latestMeaningfulCategory,
    latestMeaningfulReceivedAt,
    latestMeaningfulQueueStatus: isQueueStatus(latestMeaningfulRow?.classification_status)
      ? latestMeaningfulRow.classification_status
      : null,
    latestMeaningfulPriority: (latestMeaningfulRow?.priority as Priority | null) ?? null,
    latestMeaningfulConfidence,
    latestMeaningfulDeadline,
    latestMeaningfulActionRequired,
    queueState,
    queueStateCount:
      deadLetterCount > 0
        ? deadLetterCount
        : reviewCount > 0
          ? reviewCount
          : retryScheduledCount > 0
            ? retryScheduledCount
            : processingCount > 0
              ? processingCount
              : pendingCount,
    urgency: bestUrgency,
    urgencyRank: bestUrgencyRank,
    queueRiskRank: queueRiskScore,
    latestUpdateLabel: latestMeaningfulRow
      ? `${latestMeaningfulCategory ?? "unknown"} · ${latestMeaningfulReceivedAt ? new Intl.DateTimeFormat("en-IN", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Kolkata",
        }).format(new Date(latestMeaningfulReceivedAt)) : "—"}`
      : "No meaningful activity yet",
    hasDeadlineTomorrow: rows.some((row) => row.deadline === tomorrowIso),
  };
}

function formatTomorrowIso(now: Date): string {
  return addUtcDays(now, 1).toISOString().slice(0, 10);
}

function sortClientRows(rows: WorkspaceClientRow[]): WorkspaceClientRow[] {
  return [...rows].sort((a, b) => {
    if (a.urgencyRank !== b.urgencyRank) return a.urgencyRank - b.urgencyRank;
    const aTime = a.latestMeaningfulReceivedAt ? new Date(a.latestMeaningfulReceivedAt).getTime() : 0;
    const bTime = b.latestMeaningfulReceivedAt ? new Date(b.latestMeaningfulReceivedAt).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;
    if (a.queueRiskRank !== b.queueRiskRank) return b.queueRiskRank - a.queueRiskRank;
    return a.originalRecipient.localeCompare(b.originalRecipient);
  });
}

function mapTimelineRow(row: EmailRow, now: Date): WorkspaceTimelineRow {
  const queueAge = minutesBetween(now, queueAgeTimestamp(row));
  const isReview = row.classification_status === "review";
  const isPending = row.classification_status === "pending" || row.classification_status === "processing" || row.classification_status === "retry_scheduled";
  return {
    id: row.id,
    category: row.category && isBusinessCategory(row.category) ? row.category : "unknown",
    classificationStatus: (row.classification_status as QueueStatus | null) ?? null,
    priority: (row.priority as Priority | null) ?? null,
    confidence: row.confidence ?? null,
    receivedAt: row.received_at ?? row.created_at ?? new Date(now).toISOString(),
    deadline: row.deadline ?? null,
    actionRequired: row.action_required ?? null,
    safeReason: isReview ? sanitizeReason(row.reason ?? SAFE_REASON_FALLBACK) : null,
    queueAgeMinutes: queueAge,
    queueStatusLabel: safeQueueStatusLabel(row.classification_status),
    isPending,
    isReview,
  };
}

function mapOperationsRow(row: EmailRow, now: Date): OperationsListRow {
  const queueAge = minutesBetween(now, queueAgeTimestamp(row));
  return {
    id: row.id,
    originalRecipient: row.original_recipient,
    queueStatus: (row.classification_status as QueueStatus) ?? "pending",
    receivedAt: row.received_at ?? row.created_at ?? now.toISOString(),
    queueAgeMinutes: queueAge,
    queueAgeLabel: formatBacklogAge(queueAge),
    confidence: row.confidence ?? null,
    safeReason: row.classification_status === "review" ? sanitizeReason(row.reason ?? SAFE_REASON_FALLBACK) : null,
    deadline: row.deadline ?? null,
    actionRequired: row.action_required ?? null,
    lastErrorCode: row.last_error_code ?? null,
    nextRetryAt: row.next_retry_at ?? null,
    deadLetteredAt: row.dead_lettered_at ?? null,
  };
}

function mapReviewRow(row: EmailRow, now: Date): ReviewQueueRow {
  const queueAge = minutesBetween(now, queueAgeTimestamp(row));
  return {
    id: row.id,
    clientKey: buildClientKey(row.original_recipient ?? ""),
    originalRecipient: row.original_recipient,
    suggestedCategory: row.category && row.category !== "unknown" ? (row.category as EmailCategory) : "unknown",
    confidence: row.confidence ?? null,
    safeReason: sanitizeReason(row.reason ?? SAFE_REASON_FALLBACK),
    receivedAt: row.received_at ?? row.created_at ?? now.toISOString(),
    queueAgeMinutes: queueAge,
    queueAgeLabel: formatBacklogAge(queueAge),
    deadline: row.deadline ?? null,
    actionRequired: row.action_required ?? null,
    queueStatusLabel: safeQueueStatusLabel(row.classification_status),
  };
}

async function countRows(
  supabase: SupabaseLike,
  build: (query: SupabaseQuery) => SupabaseQuery,
): Promise<number> {
  const query = build(
    supabase.from("zoho_email_metadata").select("*", { count: "exact", head: true }),
  );
  const { count, error } = await query;
  if (error) {
    console.error("[COO Workspace] Count query failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

async function fetchRows(
  supabase: SupabaseLike,
  build: (query: SupabaseQuery) => SupabaseQuery,
  pageSize = DEFAULT_CLIENT_PAGE_LIMIT,
): Promise<EmailRow[]> {
  const rows: EmailRow[] = [];
  let offset = 0;

  while (true) {
    const query = build(
      supabase.from("zoho_email_metadata").select(SAFE_EMAIL_COLUMNS),
    ).range(offset, offset + pageSize - 1);

    const result = await query;
    if (result.error) {
      console.error("[COO Workspace] Fetch query failed:", result.error.message);
      return [];
    }

    const batch = (result.data ?? []) as EmailRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (offset > 100000) break;
  }

  return rows;
}

async function getLatestSuccessfulIngestAt(
  supabase: SupabaseLike,
  mailboxEmail: string,
): Promise<string | null> {
  const scoped = await supabase
    .from("zoho_sync_checkpoints")
    .select("last_successful_sync_at")
    .eq("mailbox_email", mailboxEmail)
    .order("last_successful_sync_at", { ascending: false })
    .range(0, 0);

  if (!scoped.error) {
    const row = (scoped.data ?? [])[0] as { last_successful_sync_at?: string | null } | undefined;
    const value = toIsoDate(row?.last_successful_sync_at ?? null);
    if (value) return value;
  }

  const fallback = await supabase
    .from("zoho_sync_checkpoints")
    .select("last_successful_sync_at")
    .order("last_successful_sync_at", { ascending: false })
    .range(0, 0);

  if (fallback.error) {
    console.error("[COO Workspace] Checkpoint query failed:", fallback.error.message);
    return null;
  }

  const row = (fallback.data ?? [])[0] as { last_successful_sync_at?: string | null } | undefined;
  return toIsoDate(row?.last_successful_sync_at ?? null);
}

function applyStageFilter(rows: EmailRow[], stageFilter: StageFilter): EmailRow[] {
  if (stageFilter === "all") {
    return rows;
  }
  if (stageFilter === "awaiting_classification") {
    return rows.filter((row) =>
      row.classification_status === "pending" ||
      row.classification_status === "processing" ||
      row.classification_status === "retry_scheduled",
    );
  }
  if (stageFilter === "classified_activity") {
    return rows.filter((row) =>
      row.classification_status === "classified" || row.classification_status === "review",
    );
  }
  return rows;
}

function applyDeadlineTomorrowFilter(rows: EmailRow[], now: Date, enabled: boolean): EmailRow[] {
  if (!enabled) return rows;
  const tomorrow = addUtcDays(now, 1).toISOString().slice(0, 10);
  return rows.filter((row) => row.deadline === tomorrow);
}

function applyBusinessRowFilter(rows: EmailRow[], filters: {
  stageFilter: StageFilter;
  deadlineTomorrowOnly: boolean;
  now: Date;
}): EmailRow[] {
  return applyDeadlineTomorrowFilter(applyStageFilter(rows, filters.stageFilter), filters.now, filters.deadlineTomorrowOnly);
}

function buildImportantActivity(rows: EmailRow[], now: Date): WorkspaceActivityRow[] {
  const filtered = rows.filter(
    (row) =>
      row.classification_status !== "dead_letter" &&
      (isImportantCategory(row.category) || row.classification_status === "review"),
  );
  const mapped = filtered
    .map((row) => {
      const queueAge = minutesBetween(now, queueAgeTimestamp(row));
      return {
        id: row.id,
        clientKey: buildClientKey(row.original_recipient ?? ""),
        originalRecipient: row.original_recipient,
        category: row.category && isBusinessCategory(row.category) ? row.category : null,
        classificationStatus: (row.classification_status as QueueStatus | null) ?? null,
        priority: row.classification_status === "review" ? "review" : priorityFromRow(row),
        confidence: row.confidence ?? null,
        receivedAt: row.received_at ?? row.created_at ?? now.toISOString(),
        deadline: row.deadline ?? null,
        actionRequired: row.action_required ?? null,
        safeReason: row.classification_status === "review" ? sanitizeReason(row.reason ?? SAFE_REASON_FALLBACK) : null,
        queueAgeMinutes: queueAge,
        queueStatusLabel: safeQueueStatusLabel(row.classification_status),
      } as WorkspaceActivityRow;
    })
    .sort((left, right) => {
      const priorityOrder = {
        job_offer: 1,
        interview_invite: 2,
        assessment: 3,
        recruiter_reply: 4,
        follow_up_needed: 4,
        review: 5,
        other: 6,
      } as const;
      const leftKey = left.classificationStatus === "review" ? "review" : (left.category ?? "other");
      const rightKey = right.classificationStatus === "review" ? "review" : (right.category ?? "other");
      const priorityDiff = (priorityOrder[leftKey as keyof typeof priorityOrder] ?? 6) - (priorityOrder[rightKey as keyof typeof priorityOrder] ?? 6);
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime();
    });

  return mapped.slice(0, 12);
}

async function loadRowsForRange(
  supabase: SupabaseLike,
  range: WorkspaceDateRange,
): Promise<EmailRow[]> {
  return fetchRows(
    supabase,
    (query) =>
      query
        .gte("received_at", range.startIso)
        .lt("received_at", range.endIso)
        .order("received_at", { ascending: false }),
  );
}

export async function getOverviewWorkspaceData(args?: {
  supabase?: SupabaseLike;
  now?: Date;
  mailboxEmail?: string;
  range?: string | null;
  from?: string | null;
  to?: string | null;
  stage?: StageFilter | string | null;
  deadlineTomorrowOnly?: boolean;
}): Promise<OverviewWorkspaceData> {
  const supabase = args?.supabase ?? (createSupabaseServerClient() as unknown as SupabaseLike);
  const now = args?.now ?? new Date();
  const mailboxEmail = normalizeEmail(args?.mailboxEmail ?? process.env.ZOHO_SYNC_MAILBOX ?? "tracker@applywizard.ai");
  const dateRange = resolveDateRange({ now, range: args?.range, from: args?.from, to: args?.to });
  const stageFilter = (args?.stage as StageFilter) ?? "all";
  const deadlineTomorrowOnly = Boolean(args?.deadlineTomorrowOnly);

  const [businessRows, queuePendingRows, queueProcessingRows, queueRetryRows, queueReviewRows, queueDeadRows] = await Promise.all([
    loadRowsForRange(supabase, dateRange),
    fetchRows(supabase, (query) => query.eq("classification_status", "pending").order("first_seen_at", { ascending: true })),
    fetchRows(supabase, (query) => query.eq("classification_status", "processing").order("claim_expires_at", { ascending: true })),
    fetchRows(supabase, (query) => query.eq("classification_status", "retry_scheduled").order("next_retry_at", { ascending: true })),
    fetchRows(supabase, (query) => query.eq("classification_status", "review").order("received_at", { ascending: false })),
    fetchRows(supabase, (query) => query.eq("classification_status", "dead_letter").order("dead_lettered_at", { ascending: false })),
  ]);

  const filteredBusinessRows = applyBusinessRowFilter(businessRows, {
    stageFilter,
    deadlineTomorrowOnly,
    now,
  });

  const filteredById = new Map<string, EmailRow>();
  for (const row of filteredBusinessRows) {
    if (!row.id) continue;
    filteredById.set(row.id, row);
  }
  const overviewRows = [...filteredById.values()];

  const metrics: WorkspaceMetrics = {
    totalEmails: overviewRows.length,
    newEmails: overviewRows.filter((row) => {
      if (!row.first_seen_at) return false;
      return row.first_seen_at >= dateRange.startIso && row.first_seen_at < dateRange.endIso;
    }).length,
    classifiedToday: overviewRows.filter((row) => {
      if (!row.classified_at) return false;
      return row.classified_at >= dateRange.startIso && row.classified_at < dateRange.endIso;
    }).length,
    pendingClassification: await countRows(supabase, (query) =>
      query.in("classification_status", ["pending", "processing", "retry_scheduled"])),
    pending: queuePendingRows.length,
    processing: queueProcessingRows.length,
    retryScheduled: queueRetryRows.length,
    review: queueReviewRows.length,
    deadLetter: queueDeadRows.length,
    applications: overviewRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "application_received").length,
    interviews: overviewRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "interview_invite").length,
    assessments: overviewRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "assessment").length,
    offers: overviewRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "job_offer").length,
    rejections: overviewRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "rejection").length,
    recruiterReplies: overviewRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "recruiter_reply").length,
    followUpNeeded: overviewRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "follow_up_needed").length,
    oldestBacklogAgeMinutes: (() => {
      const backlogRows = [...queuePendingRows, ...queueProcessingRows, ...queueRetryRows];
      const oldest = backlogRows.reduce<string | null>((currentOldest, row) => {
        const candidate = queueAgeTimestamp(row);
        if (!candidate) return currentOldest;
        if (!currentOldest) return candidate;
        return new Date(candidate).getTime() < new Date(currentOldest).getTime() ? candidate : currentOldest;
      }, null);
      return minutesBetween(now, oldest);
    })(),
    latestSuccessfulIngestAt: await getLatestSuccessfulIngestAt(supabase, mailboxEmail),
    currentProcessingCount: queueProcessingRows.length,
  };

  const clientRows = sortClientRows(
    groupByRecipient(overviewRows, now, dateRange.startIso, dateRange.endIso).filter(Boolean) as WorkspaceClientRow[],
  );
  const activityRows = buildImportantActivity(overviewRows, now);

  return {
    metrics,
    clientRows,
    activityRows,
    dateRange,
    stageFilter,
    deadlineTomorrowOnly,
  };
}

function groupByRecipient(
  rows: EmailRow[],
  now: Date,
  rangeStartIso: string,
  rangeEndIso: string,
): Array<WorkspaceClientRow | null> {
  const groups = new Map<string, EmailRow[]>();
  for (const row of rows) {
    const recipient = normalizeEmail(row.original_recipient);
    if (!recipient) continue;
    if (recipient === normalizeEmail(process.env.ZOHO_SYNC_MAILBOX ?? "tracker@applywizard.ai")) continue;
    const bucket = groups.get(recipient) ?? [];
    bucket.push(row);
    groups.set(recipient, bucket);
  }

  return [...groups.values()].map((group) => {
    const ordered = [...group].sort((a, b) => {
      const aTime = new Date(a.received_at ?? a.first_seen_at ?? a.created_at ?? 0).getTime();
      const bTime = new Date(b.received_at ?? b.first_seen_at ?? b.created_at ?? 0).getTime();
      return bTime - aTime;
    });
    return toClientRowAggregate(ordered, now, rangeStartIso, rangeEndIso);
  });
}

export async function getClientsWorkspaceData(args?: {
  supabase?: SupabaseLike;
  now?: Date;
  mailboxEmail?: string;
  range?: string | null;
  from?: string | null;
  to?: string | null;
  stage?: StageFilter | string | null;
  q?: string | null;
  urgency?: UrgencyFilter | string | null;
  queue?: QueueFilter | string | null;
}): Promise<{
  dateRange: WorkspaceDateRange;
  rows: WorkspaceClientRow[];
}> {
  const supabase = args?.supabase ?? (createSupabaseServerClient() as unknown as SupabaseLike);
  const now = args?.now ?? new Date();
  const dateRange = resolveDateRange({ now, range: args?.range, from: args?.from, to: args?.to });
  const stageFilter = (args?.stage as StageFilter) ?? "all";
  const rows = await loadRowsForRange(supabase, dateRange);
  const grouped = sortClientRows(
    groupByRecipient(applyBusinessRowFilter(rows, { stageFilter, deadlineTomorrowOnly: false, now }), now, dateRange.startIso, dateRange.endIso).filter(Boolean) as WorkspaceClientRow[],
  );

  const search = normalizeEmail(args?.q);
  const urgency = (args?.urgency as UrgencyFilter) ?? "all";
  const queue = (args?.queue as QueueFilter) ?? "all";

  const filtered = grouped.filter((row) => {
    if (search && !row.originalRecipient.includes(search)) return false;
    if (urgency !== "all") {
      if (urgency === "offers" && row.offers === 0) return false;
      if (urgency === "interviews" && row.interviews === 0) return false;
      if (urgency === "assessments" && row.assessments === 0) return false;
      if (urgency === "review_needed" && row.reviewCount === 0) return false;
    }
    if (queue !== "all") {
      if (queue === "pending" && row.pendingCount === 0) return false;
      if (queue === "processing" && row.processingCount === 0) return false;
      if (queue === "retry_scheduled" && row.retryScheduledCount === 0) return false;
      if (queue === "review" && row.reviewCount === 0) return false;
      if (queue === "dead_letter" && row.deadLetterCount === 0) return false;
    }
    return true;
  });

  return { dateRange, rows: filtered };
}

export async function getClientDetailWorkspaceData(args?: {
  supabase?: SupabaseLike;
  now?: Date;
  clientKey: string;
  range?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<ClientDetailData | null> {
  const supabase = args?.supabase ?? (createSupabaseServerClient() as unknown as SupabaseLike);
  const now = args?.now ?? new Date();
  const originalRecipient = resolveClientRecipient(args?.clientKey ?? "");
  if (!originalRecipient) return null;
  const dateRange = resolveDateRange({ now, range: args?.range, from: args?.from, to: args?.to });

  const rows = await fetchRows(
    supabase,
    (query) =>
      query
        .eq("original_recipient", originalRecipient)
        .gte("received_at", dateRange.startIso)
        .lt("received_at", dateRange.endIso)
        .order("received_at", { ascending: false }),
  );

  const timeline = rows
    .filter((row) => row.classification_status !== "dead_letter")
    .map((row) => mapTimelineRow(row, now));

  const first = rows[0];
  const summaryRow = toClientRowAggregate([...rows], now, dateRange.startIso, dateRange.endIso);

  if (!first || !summaryRow) {
    return null;
  }

  return {
    clientKey: args?.clientKey ?? buildClientKey(originalRecipient),
    originalRecipient,
    dateRange,
    summary: {
      totalEmails: summaryRow.totalEmails,
      newEmails: summaryRow.newEmails,
      applications: summaryRow.applications,
      interviews: summaryRow.interviews,
      assessments: summaryRow.assessments,
      offers: summaryRow.offers,
      rejections: summaryRow.rejections,
      recruiterReplies: summaryRow.recruiterReplies,
      followUpNeeded: summaryRow.followUpNeeded,
      reviewCount: summaryRow.reviewCount,
      pendingCount: summaryRow.pendingCount,
      processingCount: summaryRow.processingCount,
      retryScheduledCount: summaryRow.retryScheduledCount,
      deadLetterCount: summaryRow.deadLetterCount,
      latestMeaningfulCategory: summaryRow.latestMeaningfulCategory,
      latestMeaningfulReceivedAt: summaryRow.latestMeaningfulReceivedAt,
      latestMeaningfulConfidence: summaryRow.latestMeaningfulConfidence,
      latestMeaningfulDeadline: summaryRow.latestMeaningfulDeadline,
      latestMeaningfulActionRequired: summaryRow.latestMeaningfulActionRequired,
      queueState: summaryRow.queueState,
      urgency: summaryRow.urgency,
    },
    timeline,
  };
}

export async function getOperationsWorkspaceData(args?: {
  supabase?: SupabaseLike;
  now?: Date;
  mailboxEmail?: string;
}): Promise<OperationsWorkspaceData> {
  const supabase = args?.supabase ?? (createSupabaseServerClient() as unknown as SupabaseLike);
  const now = args?.now ?? new Date();
  const mailboxEmail = normalizeEmail(args?.mailboxEmail ?? process.env.ZOHO_SYNC_MAILBOX ?? "tracker@applywizard.ai");

  const [pendingRows, processingRows, retryRows, reviewRows, deadRows, latestSuccessfulIngestAt] = await Promise.all([
    fetchRows(supabase, (query) => query.eq("classification_status", "pending").order("first_seen_at", { ascending: true }).order("received_at", { ascending: true })),
    fetchRows(supabase, (query) => query.eq("classification_status", "processing").order("claim_expires_at", { ascending: true })),
    fetchRows(supabase, (query) => query.eq("classification_status", "retry_scheduled").order("next_retry_at", { ascending: true })),
    fetchRows(supabase, (query) => query.eq("classification_status", "review").order("received_at", { ascending: true })),
    fetchRows(supabase, (query) => query.eq("classification_status", "dead_letter").order("dead_lettered_at", { ascending: false })),
    getLatestSuccessfulIngestAt(supabase, mailboxEmail),
  ]);

  const pending = pendingRows.map((row) => mapOperationsRow(row, now));
  const retryScheduled = retryRows.map((row) => mapOperationsRow(row, now));
  const review = reviewRows.map((row) => mapOperationsRow(row, now));
  const deadLetter = deadRows.map((row) => mapOperationsRow(row, now));

  const oldestPending = pending.slice(0, DEFAULT_QUEUE_LIMIT);
  const oldestReview = review.slice(0, DEFAULT_QUEUE_LIMIT);
  const retryScheduledRows = retryScheduled.slice(0, DEFAULT_QUEUE_LIMIT);
  const deadLetterRows = deadLetter.slice(0, DEFAULT_QUEUE_LIMIT);

  const oldestBacklogTimestamp = [...pendingRows, ...processingRows, ...retryRows].reduce<string | null>((oldest, row) => {
    const candidate = queueAgeTimestamp(row);
    if (!candidate) return oldest;
    if (!oldest) return candidate;
    return new Date(candidate).getTime() < new Date(oldest).getTime() ? candidate : oldest;
  }, null);

  return {
    pending: pendingRows.length,
    processing: processingRows.length,
    retryScheduled: retryRows.length,
    review: reviewRows.length,
    deadLetter: deadRows.length,
    oldestBacklogAgeMinutes: minutesBetween(now, oldestBacklogTimestamp),
    latestSuccessfulIngestAt,
    currentProcessingCount: processingRows.length,
    oldestPending,
    oldestReview,
    retryScheduledRows,
    deadLetterRows,
  };
}

export async function getReviewQueueWorkspaceData(args?: {
  supabase?: SupabaseLike;
  now?: Date;
}): Promise<ReviewQueueWorkspaceData> {
  const supabase = args?.supabase ?? (createSupabaseServerClient() as unknown as SupabaseLike);
  const now = args?.now ?? new Date();
  const [count, rows] = await Promise.all([
    countRows(supabase, (query) => query.eq("classification_status", "review")),
    fetchRows(
      supabase,
      (query) => query.eq("classification_status", "review").order("received_at", { ascending: false }),
      DEFAULT_REVIEW_LIMIT,
    ),
  ]);

  const mapped = rows.map((row) => mapReviewRow(row, now));
  return {
    rows: mapped,
    count,
  };
}

export interface OverviewMetricsLegacy {
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

export interface OverviewQueueMetricsLegacy {
  pending: number;
  processing: number;
  retryScheduled: number;
  review: number;
  deadLetter: number;
  oldestBacklogAgeMinutes: number | null;
  latestSuccessfulIngestAt: string | null;
}

export interface OverviewActivityItemLegacy {
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
  metrics: OverviewMetricsLegacy;
  queue: OverviewQueueMetricsLegacy;
  importantActivity: OverviewActivityItemLegacy[];
}

export async function getOverviewDashboardData(args?: {
  supabase?: SupabaseLike;
  now?: Date;
  mailboxEmail?: string;
}): Promise<OverviewDashboardData> {
  const supabase = args?.supabase ?? (createSupabaseServerClient() as unknown as SupabaseLike);
  const now = args?.now ?? new Date();
  const mailboxEmail = normalizeEmail(args?.mailboxEmail ?? process.env.ZOHO_SYNC_MAILBOX ?? "tracker@applywizard.ai");
  const startIso = startOfUtcDay(now);
  const endIso = endOfUtcDay(now);

  const [receivedTodayRows, classifiedTodayRows] = await Promise.all([
    fetchRows(supabase, (query) => query.gte("received_at", startIso).lt("received_at", endIso).order("received_at", { ascending: false })),
    fetchRows(supabase, (query) => query.gte("classified_at", startIso).lt("classified_at", endIso).order("classified_at", { ascending: false })),
  ]);

  const todayRowsById = new Map<string, EmailRow>();
  for (const row of [...receivedTodayRows, ...classifiedTodayRows]) {
    if (!row?.id) continue;
    todayRowsById.set(row.id, row);
  }
  const todayRows = [...todayRowsById.values()];

  const [emailsReceivedToday, pending, processing, retryScheduled, review, deadLetter] = await Promise.all([
    countRows(supabase, (query) => query.gte("received_at", startIso).lt("received_at", endIso)),
    countRows(supabase, (query) => query.eq("classification_status", "pending")),
    countRows(supabase, (query) => query.eq("classification_status", "processing")),
    countRows(supabase, (query) => query.eq("classification_status", "retry_scheduled")),
    countRows(supabase, (query) => query.eq("classification_status", "review")),
    countRows(supabase, (query) => query.eq("classification_status", "dead_letter")),
  ]);

  const applicationReceivedToday = todayRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "application_received").length;
  const classifiedToday = todayRows.filter((row) => row.classified_at && row.classified_at >= startIso && row.classified_at < endIso).length;
  const interviewInviteToday = todayRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "interview_invite").length;
  const assessmentToday = todayRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "assessment").length;
  const jobOfferToday = todayRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "job_offer").length;
  const rejectionToday = todayRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "rejection").length;
  const recruiterReplyToday = todayRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "recruiter_reply").length;
  const followUpNeededToday = todayRows.filter((row) => row.classification_status !== "dead_letter" && row.category === "follow_up_needed").length;

  const backlogRows = await fetchRows(
    supabase,
    (query) => query.in("classification_status", ["pending", "processing", "retry_scheduled"]).order("first_seen_at", { ascending: true }),
    1000,
  );

  const oldestBacklogTimestamp = backlogRows.reduce<string | null>((oldest, row) => {
    const candidate = queueAgeTimestamp(row);
    if (!candidate) return oldest;
    if (!oldest) return candidate;
    return new Date(candidate).getTime() < new Date(oldest).getTime() ? candidate : oldest;
  }, null);

  const importantRows = todayRows.filter(
    (row) =>
      row.classification_status !== "dead_letter" &&
      (isImportantCategory(row.category) || row.classification_status === "review"),
  );
  const activityRankById = new Map(
    importantRows.map((row) => [row.id, row.classification_status === "review" ? 5 : IMPORTANT_CATEGORIES.indexOf(row.category as (typeof IMPORTANT_CATEGORIES)[number]) + 1] as const),
  );

  const importantActivity = importantRows
    .map((row) => ({
      id: row.id,
      originalRecipient: row.original_recipient ?? null,
      category: row.category && isBusinessCategory(row.category) ? row.category : null,
      classificationStatus: row.classification_status ?? "classified",
      priority: row.classification_status === "review"
        ? "review"
        : row.category === "job_offer"
          ? "critical"
          : row.category === "interview_invite" || row.category === "assessment"
            ? "high"
            : "normal",
      confidence: row.confidence ?? null,
      receivedAt: row.received_at ?? now.toISOString(),
      deadline: row.deadline ?? null,
      actionRequired: row.action_required ?? null,
      safeReason: row.classification_status === "review" ? sanitizeReason(row.reason ?? SAFE_REASON_FALLBACK) : null,
    } as OverviewActivityItemLegacy))
    .sort((left, right) => {
      const leftRank = activityRankById.get(left.id) ?? 6;
      const rightRank = activityRankById.get(right.id) ?? 6;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime();
    })
    .slice(0, 12);

  return {
    metrics: {
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
    },
    queue: {
      pending,
      processing,
      retryScheduled,
      review,
      deadLetter,
      oldestBacklogAgeMinutes: minutesBetween(now, oldestBacklogTimestamp),
      latestSuccessfulIngestAt: await getLatestSuccessfulIngestAt(supabase, mailboxEmail),
    },
    importantActivity,
  };
}

export {
  formatBacklogAge,
  resolveDateRange,
  safeQueueStatusLabel,
  startOfUtcDay,
  endOfUtcDay,
};
