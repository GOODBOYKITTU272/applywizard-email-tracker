// Pure, deterministic synthetic dataset for the isolated Preview project only.
// No secrets, no DB access, no real customer data — every value is fictional and
// uses the reserved `example.test` domain. The runner (scripts/preview-demo) is
// the only place that touches Supabase, and only after a hard Preview-ref guard.

export const PREVIEW_DEMO_MARKER = "preview_demo_v1";
export const PREVIEW_DEMO_FOLDER_NAME = "Preview Demo";
export const PREVIEW_DEMO_CHECKPOINT_MAILBOX = "preview-demo-sync@example.test";

const MAILBOXES = ["demo.user1@example.test", "demo.user2@example.test"] as const;
const COMPANIES = ["Northstar Labs", "BluePeak Systems", "CedarWorks", "DemoCorp", "SampleTech"] as const;
// Fictional client recipients so the Master Client Tracking table (grouped by
// original_recipient) shows multiple synthetic clients with meaningful totals.
const CLIENTS = ["client.alpha@example.test", "client.beta@example.test", "client.gamma@example.test"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

const SUBJECTS = {
  interview_invite: "Synthetic interview invitation",
  assessment: "Synthetic assessment request",
  application_received: "Synthetic application update",
  recruiter_reply: "Synthetic recruiter follow-up",
  rejection: "Synthetic rejection notice",
} as const;

type SubjectKey = keyof typeof SUBJECTS;

export type PreviewDemoStatus =
  | "pending"
  | "processing"
  | "retry_scheduled"
  | "classified"
  | "review"
  | "dead_letter"
  | "historical_ingested";

interface RowSpec {
  daysAgo: number;
  status: PreviewDemoStatus;
  subject: SubjectKey;
  category?: string;
  priority?: "critical" | "high" | "normal" | "low";
  deadlineTomorrow?: boolean;
  mailbox: 0 | 1;
  company: number;
}

// Explicit spread so every dashboard card has at least one row and the date
// filters (Today / Yesterday / 7d / 30d / older) each produce a distinct count.
const ROW_SPECS: RowSpec[] = [
  // Today
  { daysAgo: 0, status: "classified", subject: "interview_invite", category: "interview_invite", priority: "high", mailbox: 0, company: 0 },
  { daysAgo: 0, status: "pending", subject: "application_received", mailbox: 1, company: 1 },
  { daysAgo: 0, status: "processing", subject: "assessment", mailbox: 0, company: 2 },
  { daysAgo: 0, status: "review", subject: "recruiter_reply", category: "recruiter_reply", priority: "critical", deadlineTomorrow: true, mailbox: 1, company: 3 },
  { daysAgo: 0, status: "classified", subject: "application_received", category: "job_offer", priority: "high", mailbox: 0, company: 4 },
  // Yesterday
  { daysAgo: 1, status: "classified", subject: "rejection", category: "rejection", priority: "low", mailbox: 1, company: 0 },
  { daysAgo: 1, status: "retry_scheduled", subject: "assessment", mailbox: 0, company: 1 },
  { daysAgo: 1, status: "pending", subject: "application_received", mailbox: 1, company: 2 },
  { daysAgo: 1, status: "classified", subject: "assessment", category: "assessment", priority: "normal", deadlineTomorrow: true, mailbox: 0, company: 3 },
  // Within last 7 days
  { daysAgo: 3, status: "classified", subject: "interview_invite", category: "interview_invite", priority: "high", mailbox: 1, company: 4 },
  { daysAgo: 4, status: "classified", subject: "recruiter_reply", category: "recruiter_reply", priority: "normal", mailbox: 0, company: 0 },
  { daysAgo: 4, status: "pending", subject: "application_received", mailbox: 1, company: 1 },
  { daysAgo: 5, status: "review", subject: "assessment", category: "assessment", priority: "high", mailbox: 0, company: 2 },
  { daysAgo: 6, status: "dead_letter", subject: "recruiter_reply", mailbox: 1, company: 3 },
  { daysAgo: 6, status: "classified", subject: "application_received", category: "application_received", priority: "normal", mailbox: 0, company: 4 },
  // Within last 30 days
  { daysAgo: 10, status: "classified", subject: "rejection", category: "rejection", priority: "low", mailbox: 1, company: 0 },
  { daysAgo: 13, status: "classified", subject: "interview_invite", category: "interview_invite", priority: "high", mailbox: 0, company: 1 },
  { daysAgo: 16, status: "pending", subject: "application_received", mailbox: 1, company: 2 },
  { daysAgo: 19, status: "retry_scheduled", subject: "assessment", mailbox: 0, company: 3 },
  { daysAgo: 22, status: "processing", subject: "recruiter_reply", mailbox: 1, company: 4 },
  { daysAgo: 25, status: "classified", subject: "application_received", category: "follow_up_needed", priority: "normal", mailbox: 0, company: 0 },
  // Older than 30 days
  { daysAgo: 40, status: "historical_ingested", subject: "application_received", mailbox: 1, company: 1 },
  { daysAgo: 45, status: "historical_ingested", subject: "rejection", mailbox: 0, company: 2 },
  { daysAgo: 52, status: "classified", subject: "interview_invite", category: "interview_invite", priority: "low", mailbox: 1, company: 3 },
];

export interface PreviewDemoEmailRow {
  mailbox_email: string;
  message_id: string;
  sender: string;
  subject: string;
  original_recipient: string;
  received_at: string;
  folder_id: string;
  folder_name: string;
  first_seen_at: string;
  last_seen_at: string;
  sync_status: string;
  company_name: string;
  category: string | null;
  classification_status: PreviewDemoStatus;
  classified_at: string | null;
  deadline: string | null;
  priority: string | null;
  needs_human_review: boolean;
  action_required: string | null;
  reason: string | null;
  confidence: number | null;
  attempt_count: number;
  next_retry_at: string | null;
  claim_expires_at: string | null;
  dead_lettered_at: string | null;
  last_error_code: string | null;
  routing_status: string;
  email_direction: string;
}

export interface PreviewDemoCheckpointRow {
  mailbox_email: string;
  last_seen_message_id: string;
  last_seen_received_at: string;
  last_successful_sync_at: string;
}

function companySlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildEmailRow(spec: RowSpec, index: number, now: Date, startOfToday: number): PreviewDemoEmailRow {
  const nowMs = now.getTime();
  // Anchor to UTC calendar buckets so coverage is stable at any seed time.
  // "Today" rows land between UTC midnight and now (never in the future or in
  // yesterday); older rows sit at midday of their UTC day.
  let receivedMs: number;
  if (spec.daysAgo === 0) {
    const elapsedToday = nowMs - startOfToday;
    const fraction = ((index % 5) + 1) / 6;
    receivedMs = startOfToday + Math.floor(elapsedToday * fraction);
  } else {
    receivedMs = startOfToday - spec.daysAgo * DAY_MS + 12 * 60 * 60 * 1000;
  }
  const receivedAt = new Date(receivedMs).toISOString();
  const company = COMPANIES[spec.company];

  const tomorrow = new Date(startOfToday + DAY_MS).toISOString().slice(0, 10);

  const row: PreviewDemoEmailRow = {
    mailbox_email: MAILBOXES[spec.mailbox],
    message_id: `preview-demo-${String(index + 1).padStart(4, "0")}`,
    sender: `talent@${companySlug(company)}.example.test`,
    subject: SUBJECTS[spec.subject],
    original_recipient: CLIENTS[index % CLIENTS.length],
    received_at: receivedAt,
    folder_id: PREVIEW_DEMO_MARKER,
    folder_name: PREVIEW_DEMO_FOLDER_NAME,
    first_seen_at: receivedAt,
    last_seen_at: receivedAt,
    sync_status: "synced",
    company_name: company,
    category: spec.category ?? null,
    classification_status: spec.status,
    classified_at: null,
    deadline: spec.deadlineTomorrow ? tomorrow : null,
    priority: spec.priority ?? null,
    needs_human_review: spec.status === "review",
    action_required: spec.status === "review" ? "Review classification" : null,
    reason: null,
    confidence: spec.status === "classified" ? 0.9 : null,
    attempt_count: 0,
    next_retry_at: null,
    claim_expires_at: null,
    dead_lettered_at: null,
    last_error_code: null,
    routing_status: "routed",
    email_direction: "incoming",
  };

  if (spec.status === "classified") {
    row.classified_at = receivedAt;
  } else if (spec.status === "processing") {
    row.attempt_count = 1;
    row.claim_expires_at = new Date(nowMs + 30 * 60 * 1000).toISOString();
  } else if (spec.status === "retry_scheduled") {
    row.attempt_count = 2;
    row.next_retry_at = new Date(nowMs + 15 * 60 * 1000).toISOString();
    row.last_error_code = "RETRYABLE_SYNTHETIC";
  } else if (spec.status === "dead_letter") {
    row.attempt_count = 5;
    row.dead_lettered_at = new Date(receivedMs + 60 * 60 * 1000).toISOString();
    row.last_error_code = "MAX_RETRIES_SYNTHETIC";
  }

  return row;
}

export function buildPreviewDemoDataset(now: Date = new Date()): {
  marker: string;
  emails: PreviewDemoEmailRow[];
  checkpoint: PreviewDemoCheckpointRow;
} {
  const startOfToday = startOfUtcDay(now);
  const emails = ROW_SPECS.map((spec, index) => buildEmailRow(spec, index, now, startOfToday));
  const latestReceived = emails.reduce(
    (latest, row) => (row.received_at > latest ? row.received_at : latest),
    emails[0].received_at,
  );

  return {
    marker: PREVIEW_DEMO_MARKER,
    emails,
    checkpoint: {
      mailbox_email: PREVIEW_DEMO_CHECKPOINT_MAILBOX,
      last_seen_message_id: PREVIEW_DEMO_MARKER,
      last_seen_received_at: latestReceived,
      last_successful_sync_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
    },
  };
}
