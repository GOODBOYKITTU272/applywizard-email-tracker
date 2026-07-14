import { classifyEmail } from "./emailClassification";
import type { EmailCategory, Priority } from "./types";
import type { Application } from "@/lib/mockData";

type RuntimeQueueStatus = Application["status"];

export interface DerivedClassification {
  category: EmailCategory;
  confidence: number;
  priority: Priority;
  needs_human_review: boolean;
  deadline: string | null;
  reason: string;
}

export interface ClassifiedApplication extends Application {
  derived: DerivedClassification;
}

// Job-related categories shown in the Applications list.
export const JOB_CATEGORIES: EmailCategory[] = [
  "application_received",
  "interview_invite",
  "assessment",
  "rejection",
  "job_offer",
  "recruiter_reply",
  "follow_up_needed",
  "unknown",
];

// Categories that may surface in Review Queue / Attention Needed.
export const REVIEW_CATEGORIES: EmailCategory[] = [
  "job_offer",
  "interview_invite",
  "assessment",
  "recruiter_reply",
  "follow_up_needed",
  "unknown",
];

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function normalizeMockStatus(
  status: RuntimeQueueStatus,
  needsHumanReview: boolean,
): RuntimeQueueStatus {
  if (
    status === "pending" ||
    status === "processing" ||
    status === "retry_scheduled" ||
    status === "dead_letter"
  ) {
    return status;
  }

  return needsHumanReview ? "review" : "classified";
}

export function classifyApplications(
  apps: Application[]
): ClassifiedApplication[] {
  return apps.map((app) => {
    const result = classifyEmail({
      subject: app.subject,
      body: app.body,
      sender: app.sender,
      receivedDate: app.receivedDate,
    });
    const derived: DerivedClassification = {
      category: result.category,
      confidence: result.confidence,
      priority: result.priority ?? "normal",
      needs_human_review: result.needs_human_review,
      deadline: result.deadline,
      reason: result.reason,
    };
    return {
      ...app,
      status: normalizeMockStatus(app.status, derived.needs_human_review),
      derived,
    };
  });
}

export function sortByPriority(
  items: ClassifiedApplication[]
): ClassifiedApplication[] {
  return [...items].sort((a, b) => {
    const pd =
      PRIORITY_ORDER[a.derived.priority] - PRIORITY_ORDER[b.derived.priority];
    if (pd !== 0) return pd;
    if (a.derived.deadline && b.derived.deadline)
      return a.derived.deadline.localeCompare(b.derived.deadline);
    if (a.derived.deadline) return -1;
    if (b.derived.deadline) return 1;
    return 0;
  });
}
