import type {
  ClassificationResult,
  EmailCategory,
  Priority,
} from "./types";
import { detectPortal } from "./portalDetector";

export interface DeterministicEmailInput {
  subject: string;
  body: string;
  sender?: string;
  receivedDate?: string;
}

// ── helpers ────────────────────────────────────────────────────────────────

function text(input: DeterministicEmailInput): string {
  return `${input.sender ?? ""} ${input.subject} ${input.body}`.toLowerCase();
}

// ponytail: naive regex scan; upgrade to chrono-node if edge cases accumulate.
const DATE_PATTERN =
  /\b(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/i;

function extractDeadline(input: DeterministicEmailInput): string | null {
  const m = `${input.subject} ${input.body}`.match(DATE_PATTERN);
  return m ? m[0].trim() : null;
}

function priorityFor(
  category: EmailCategory,
  deadline: string | null
): { priority: Priority; needs_human_review: boolean } {
  switch (category) {
    case "job_offer":
      return { priority: "critical", needs_human_review: true };
    case "interview_invite":
      return { priority: deadline ? "critical" : "high", needs_human_review: true };
    case "assessment":
      return { priority: "high", needs_human_review: true };
    case "recruiter_reply":
      return { priority: "high", needs_human_review: true };
    case "follow_up_needed":
      return { priority: "high", needs_human_review: true };
    case "application_received":
      return { priority: "normal", needs_human_review: false };
    case "rejection":
      return { priority: "low", needs_human_review: false };
    case "system_notification":
      return { priority: "low", needs_human_review: false };
    case "spam_or_irrelevant":
      return { priority: "low", needs_human_review: false };
    case "otp_verification":
      return { priority: "low", needs_human_review: false };
    case "email_verification":
      return { priority: "low", needs_human_review: false };
    case "account_created":
      return { priority: "low", needs_human_review: false };
    case "unknown":
      return { priority: "normal", needs_human_review: true };
  }
}

// ── Step 1: system-protection rules ───────────────────────────────────────
// These always run before job rules. Order within this step: most specific first.

// OTP / verification — maps to existing otp_verification / email_verification
const OTP_SIGNALS = [
  "one-time password",
  "one time password",
  "otp:",
  " otp ",
  "your otp",
  "verification code",
  "your code is",
  "passcode",
  "access code",
  "security code",
  "authentication code",
  "login code",
  "sign-in code",
];

const EMAIL_VERIFY_SIGNALS = [
  "verify your email",
  "confirm your email",
  "activate your account",
  "email confirmation",
  "confirm your account",
  "please verify",
];

const ACCOUNT_CREATED_SIGNALS = [
  "account has been created",
  "account created",
  "profile has been created",
  "profile created",
  "registration successful",
  "successfully registered",
  "account is ready",
  "account set up",
  "account setup complete",
  "candidate profile has been",
  "profile has been successfully set up",
];

// Zoho/admin/security/billing — maps to system_notification
const SYSTEM_SIGNALS = [
  "zoho",
  "zohocorp",
  "mailadmin",
  "postmaster",
  "security alert",
  "sign-in alert",
  "login alert",
  "unusual sign",
  "unrecognized device",
  "password reset",
  "reset your password",
  "invoice",
  "payment due",
  "payment receipt",
  "subscription renewal",
  "your subscription",
  "storage limit",
  "license expiry",
  "license renewal",
  "service maintenance",
  "scheduled maintenance",
  "system update",
  "account sign-in",
  "2fa",
  "two-factor",
  "accounts@",
  "billing@",
  "support@zoho",
  "admin@",
];

// Newsletter / marketing — maps to spam_or_irrelevant
const SPAM_SIGNALS = [
  "unsubscribe",
  "you are receiving this",
  "newsletter",
  "special offer",
  "limited time offer",
  "sale ends",
  "click here to claim",
  "congratulations you",
  "you have been selected",
  "act now",
  "earn money",
];

type SystemMatch = {
  category: Extract<
    EmailCategory,
    | "otp_verification"
    | "email_verification"
    | "account_created"
    | "system_notification"
    | "spam_or_irrelevant"
  >;
  confidence: number;
  reason: string;
} | null;

function matchSystem(t: string): SystemMatch {
  for (const s of OTP_SIGNALS) {
    if (t.includes(s))
      return {
        category: "otp_verification",
        confidence: 0.97,
        reason: "Deterministic system classification matched.",
      };
  }
  for (const s of EMAIL_VERIFY_SIGNALS) {
    if (t.includes(s))
      return {
        category: "email_verification",
        confidence: 0.97,
        reason: "Deterministic system classification matched.",
      };
  }
  for (const s of ACCOUNT_CREATED_SIGNALS) {
    if (t.includes(s))
      return {
        category: "account_created",
        confidence: 0.97,
        reason: "Deterministic system classification matched.",
      };
  }
  for (const s of SYSTEM_SIGNALS) {
    if (t.includes(s))
      return {
        category: "system_notification",
        confidence: 0.95,
        reason: "Deterministic system classification matched.",
      };
  }
  for (const s of SPAM_SIGNALS) {
    if (t.includes(s))
      return {
        category: "spam_or_irrelevant",
        confidence: 0.9,
        reason: "Deterministic system classification matched.",
      };
  }
  return null;
}

// ── Step 2: deterministic job rules ───────────────────────────────────────

interface JobRule {
  category: EmailCategory;
  confidence: number;
  signals: string[];
}

const JOB_RULES: JobRule[] = [
  {
    category: "job_offer",
    confidence: 0.95,
    signals: [
      "offer letter",
      "job offer",
      "offer extended",
      "pleased to offer",
      "welcome aboard",
      "compensation package",
      "joining date",
      "we are delighted to offer",
      "formal offer",
    ],
  },
  {
    category: "interview_invite",
    confidence: 0.93,
    signals: [
      "interview invitation",
      "schedule an interview",
      "schedule interview",
      "we would like to invite you",
      "invite you for an interview",
      "interview with us",
      "availability for interview",
      "availability for a call",
      "zoom interview",
      "teams interview",
      "google meet interview",
      "phone interview",
      "virtual interview",
      "on-site interview",
      "panel interview",
    ],
  },
  {
    category: "assessment",
    confidence: 0.93,
    signals: [
      "coding assessment",
      "technical assessment",
      "online test",
      "online assessment",
      "hackerrank",
      "codesignal",
      "codility",
      " oa ",
      "take-home assignment",
      "take home assignment",
      "complete the following assessment",
      "skills assessment",
    ],
  },
  {
    category: "rejection",
    confidence: 0.92,
    signals: [
      "regrettably",
      "unfortunately",
      "not moving forward",
      "decided not to proceed",
      "will not be moving forward",
      "have decided to pursue other candidates",
      "position has been filled",
      "not selected",
      "move forward with other candidates",
      "wish you all the best",
      "wish you the best",
    ],
  },
  {
    category: "application_received",
    confidence: 0.9,
    signals: [
      "application received",
      "thank you for applying",
      "application submitted",
      "we received your application",
      "your application has been",
      "thanks for applying",
      "application confirmation",
    ],
  },
  {
    category: "recruiter_reply",
    confidence: 0.82,
    signals: [
      "talent acquisition",
      "hiring manager",
      "i am a recruiter",
      "i'm a recruiter",
      "i am reaching out",
      "i'm reaching out",
      "exciting opportunity",
      "open role",
      "open position",
    ],
  },
  {
    category: "follow_up_needed",
    confidence: 0.8,
    signals: [
      "follow up",
      "following up",
      "next steps",
      "required information",
      "action needed",
      "action required",
      "please respond",
      "awaiting your response",
      "pending your confirmation",
    ],
  },
];

function matchJob(
  t: string
): { category: EmailCategory; confidence: number; reason: string } | null {
  for (const rule of JOB_RULES) {
    for (const sig of rule.signals) {
      if (t.includes(sig)) {
        return {
          category: rule.category,
          confidence: rule.confidence,
          reason: "Deterministic job classification matched.",
        };
      }
    }
  }
  return null;
}

// ── Main export ────────────────────────────────────────────────────────────

export function classifyEmail(
  input: DeterministicEmailInput
): ClassificationResult {
  const t = text(input);
  const deadline = extractDeadline(input);
  const portal = detectPortal(input.subject, input.body);

  const base = {
    company_name: null,
    job_title: null,
    candidate_email: null,
    action_required: null,
    verification_code: null,
    verification_link: null,
    expires_at: null,
    source_portal: portal,
    reviewed_by: "regex_parser" as const,
  };

  // Step 1 — system protection always wins
  const sys = matchSystem(t);
  if (sys) {
    const { priority, needs_human_review } = priorityFor(sys.category, null);
    return { ...base, ...sys, deadline: null, priority, needs_human_review };
  }

  // Step 2 — deterministic job rules
  const job = matchJob(t);
  if (job) {
    const { priority, needs_human_review } = priorityFor(job.category, deadline);
    return { ...base, ...job, deadline, priority, needs_human_review };
  }

  // Step 3 — unknown fallback
  return {
    ...base,
    category: "unknown",
    confidence: 0.4,
    reason: "No deterministic rule matched",
    deadline: null,
    priority: "normal",
    needs_human_review: true,
  };
}
