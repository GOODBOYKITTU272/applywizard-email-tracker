import { describe, test, expect } from "vitest";
import { classifyEmail } from "./emailClassification";

function make(
  subject: string,
  body: string,
  sender = "someone@example.com"
) {
  return classifyEmail({
    sender,
    subject,
    body,
    receivedDate: "2026-06-23T10:00:00Z",
  });
}

// ── System-protection: OTP / verification ─────────────────────────────────

describe("System protection — OTP / verification / account", () => {
  test("TC01 OTP email → otp_verification, low, no review", () => {
    const r = make(
      "Your OTP: 482910",
      "Use OTP 482910 to verify your account. Valid for 10 minutes.",
      "security@workday.com"
    );
    expect(r.category).toBe("otp_verification");
    expect(r.priority).toBe("low");
    expect(r.needs_human_review).toBe(false);
    expect(r.deadline).toBeNull();
    expect(r.reason).toBe("Deterministic system classification matched.");
    expect(r.reason).not.toContain("482910");
  });

  test("TC02 Verification code subject → otp_verification", () => {
    const r = make(
      "Your verification code is 8821",
      "Enter code 8821 to complete sign-in.",
      "noreply@greenhouse.io"
    );
    expect(r.category).toBe("otp_verification");
    expect(r.needs_human_review).toBe(false);
  });

  test("TC03 Email verification link → email_verification, low, no review", () => {
    const r = make(
      "Verify your email address",
      "Please verify your email by clicking the link: https://portal.example.com/verify?token=abc123",
      "accounts@lever.co"
    );
    expect(r.category).toBe("email_verification");
    expect(r.priority).toBe("low");
    expect(r.needs_human_review).toBe(false);
  });

  test("TC04 Confirm your email → email_verification", () => {
    const r = make(
      "Confirm your email to activate your account",
      "Click here to confirm your email.",
      "portal@icims.com"
    );
    expect(r.category).toBe("email_verification");
  });

  test("TC05 Account created → account_created, low, no review", () => {
    const r = make(
      "Your account has been created",
      "Welcome! Your Workday account is ready. Sign in to get started.",
      "no-reply@workday.com"
    );
    expect(r.category).toBe("account_created");
    expect(r.priority).toBe("low");
    expect(r.needs_human_review).toBe(false);
  });

  test("TC06 Registration successful → account_created", () => {
    const r = make(
      "Registration successful",
      "Your profile has been created on Greenhouse.",
      "accounts@greenhouse.io"
    );
    expect(r.category).toBe("account_created");
  });
});

// ── System-protection: system_notification ────────────────────────────────

describe("System protection — system_notification", () => {
  test("TC07 Zoho security alert → system_notification, low", () => {
    const r = make(
      "Security Alert: New login to your Zoho account",
      "A new sign-in was detected from an unrecognized device.",
      "security@zohocorp.com"
    );
    expect(r.category).toBe("system_notification");
    expect(r.priority).toBe("low");
    expect(r.needs_human_review).toBe(false);
  });

  test("TC08 Password reset email → system_notification", () => {
    const r = make(
      "Reset your password",
      "Click the link below to reset your password.",
      "support@applywizard.ai"
    );
    expect(r.category).toBe("system_notification");
    expect(r.reason).toBe("Deterministic system classification matched.");
    expect(r.reason).not.toContain("password");
  });

  test("TC09 Invoice email → system_notification", () => {
    const r = make(
      "Invoice #INV-2026-0042 from Zoho",
      "Please find your invoice for the current billing period.",
      "billing@zoho.com"
    );
    expect(r.category).toBe("system_notification");
  });

  test("TC10 Subscription renewal → system_notification", () => {
    const r = make(
      "Your subscription renews in 7 days",
      "Your Zoho Mail subscription renewal is due.",
      "accounts@zoho.com"
    );
    expect(r.category).toBe("system_notification");
  });

  test("TC11 Storage limit warning → system_notification", () => {
    const r = make(
      "You have reached 90% of your storage limit",
      "Your mailbox is almost full. Please upgrade.",
      "admin@zohocorp.com"
    );
    expect(r.category).toBe("system_notification");
  });

  test("TC12 Service maintenance notice → system_notification", () => {
    const r = make(
      "Scheduled maintenance on June 30",
      "We will be performing service maintenance. Expect brief downtime.",
      "support@zoho.com"
    );
    expect(r.category).toBe("system_notification");
  });
});

// ── System-protection: spam_or_irrelevant ─────────────────────────────────

describe("System protection — spam_or_irrelevant", () => {
  test("TC13 Newsletter with unsubscribe → spam_or_irrelevant, low", () => {
    const r = make(
      "Top 10 job boards this week",
      "You are receiving this because you subscribed. Click here to unsubscribe.",
      "newsletter@jobsites.com"
    );
    expect(r.category).toBe("spam_or_irrelevant");
    expect(r.priority).toBe("low");
    expect(r.needs_human_review).toBe(false);
  });
});

// ── Job classification ────────────────────────────────────────────────────

describe("Job rules", () => {
  test("TC14 Application received → normal, no review", () => {
    const r = make(
      "Thank you for applying to Software Engineer at Acme Corp",
      "We have received your application and will be in touch.",
      "careers@acme.com"
    );
    expect(r.category).toBe("application_received");
    expect(r.priority).toBe("normal");
    expect(r.needs_human_review).toBe(false);
    expect(r.reason).toBe("Deterministic job classification matched.");
    expect(r.reason).not.toContain("thank you for applying");
  });

  test("TC15 Interview invitation (no deadline) → high, review true", () => {
    const r = make(
      "Interview Invitation — Software Engineer",
      "We would like to invite you for a virtual interview with our team.",
      "recruiter@techcorp.com"
    );
    expect(r.category).toBe("interview_invite");
    expect(r.priority).toBe("high");
    expect(r.needs_human_review).toBe(true);
  });

  test("TC16 Interview invitation with explicit deadline → critical", () => {
    const r = make(
      "Interview Invitation — Please confirm by June 28",
      "We would like to schedule an interview. Please confirm availability by June 28.",
      "hr@startup.io"
    );
    expect(r.category).toBe("interview_invite");
    expect(r.priority).toBe("critical");
    expect(r.needs_human_review).toBe(true);
    expect(r.deadline).not.toBeNull();
  });

  test("TC17 HackerRank assessment (assessment sender) → assessment, high", () => {
    const r = make(
      "Complete your HackerRank assessment for Acme Corp",
      "Please complete the HackerRank assessment before July 1.",
      "assessments@hackerrank.com"
    );
    expect(r.category).toBe("assessment");
    expect(r.priority).toBe("high");
    expect(r.needs_human_review).toBe(true);
    expect(r.deadline).not.toBeNull();
  });

  test("TC18 CodeSignal assessment → assessment", () => {
    const r = make(
      "Complete your CodeSignal assessment",
      "Please complete the online assessment at CodeSignal before August 1.",
      "hr@techco.com"
    );
    expect(r.category).toBe("assessment");
  });

  test("TC19 Job offer letter → critical, review true", () => {
    const r = make(
      "Offer Letter — Software Engineer at Acme Corp",
      "We are pleased to offer you the position. Please review the compensation package.",
      "hr@acme.com"
    );
    expect(r.category).toBe("job_offer");
    expect(r.priority).toBe("critical");
    expect(r.needs_human_review).toBe(true);
  });

  test("TC20 Welcome aboard → job_offer, critical", () => {
    const r = make(
      "Welcome aboard — your offer is ready",
      "We are thrilled to have you. Please sign and return the attached offer letter.",
      "hr@startup.com"
    );
    expect(r.category).toBe("job_offer");
    expect(r.priority).toBe("critical");
  });

  test("TC21 Rejection email → low, no review", () => {
    const r = make(
      "Update on your application to Acme Corp",
      "We regrettably inform you that we will not be moving forward with your application.",
      "careers@acme.com"
    );
    expect(r.category).toBe("rejection");
    expect(r.priority).toBe("low");
    expect(r.needs_human_review).toBe(false);
  });

  test("TC22 Recruiter outreach → high, review true", () => {
    const r = make(
      "Exciting opportunity — Senior Engineer role",
      "Hi, I am reaching out regarding an exciting opportunity. Talent acquisition team.",
      "recruiter@headhunter.io"
    );
    expect(r.category).toBe("recruiter_reply");
    expect(r.priority).toBe("high");
    expect(r.needs_human_review).toBe(true);
  });

  test("TC23 Follow-up action needed → high, review true", () => {
    const r = make(
      "Action Required: Please confirm your next steps",
      "This is a follow up. Action required before we can proceed.",
      "hiring@corp.com"
    );
    expect(r.category).toBe("follow_up_needed");
    expect(r.priority).toBe("high");
    expect(r.needs_human_review).toBe(true);
  });

  test("TC24 Unknown / ambiguous email → unknown, normal, review true", () => {
    const r = make(
      "Touching base",
      "Just wanted to say hello and see how things are going.",
      "randomguy@gmail.com"
    );
    expect(r.category).toBe("unknown");
    expect(r.confidence).toBeLessThan(0.7);
    expect(r.needs_human_review).toBe(true);
    expect(r.priority).toBe("normal");
  });
});

// ── Deadline extraction ───────────────────────────────────────────────────

describe("Deadline extraction", () => {
  test("TC25 Offer deadline extracted", () => {
    const r = make(
      "Offer Letter — Acme Corp",
      "Please accept or decline by July 5, 2026. We look forward to welcoming you aboard.",
      "hr@acme.com"
    );
    expect(r.category).toBe("job_offer");
    expect(r.deadline).toMatch(/july 5/i);
  });

  test("TC26 Application without date → deadline null", () => {
    const r = make(
      "Application Submitted Successfully",
      "Thank you for applying. We will review your application and get back to you.",
      "careers@company.com"
    );
    expect(r.category).toBe("application_received");
    expect(r.deadline).toBeNull();
  });

  test("TC27 Zoom interview with explicit date → deadline not null", () => {
    const r = make(
      "Zoom Interview Scheduled — Thursday July 3",
      "Your Zoom interview is confirmed. Please join the link on July 3.",
      "interviews@bigco.com"
    );
    expect(r.category).toBe("interview_invite");
    expect(r.deadline).not.toBeNull();
  });
});

// ── False-positive safety tests ───────────────────────────────────────────

describe("False-positive safety", () => {
  test("TC28 Security email containing 'application' → system_notification, NOT application_received", () => {
    const r = make(
      "Security alert for your application",
      "A sign-in alert was triggered for the application associated with your account.",
      "security@zohocorp.com"
    );
    expect(r.category).toBe("system_notification");
    expect(r.category).not.toBe("application_received");
  });

  test("TC29 Invoice email containing 'offer' → system_notification, NOT job_offer", () => {
    const r = make(
      "Invoice for your Zoho plan",
      "We are pleased to offer you the invoice for your subscription renewal.",
      "billing@zoho.com"
    );
    expect(r.category).toBe("system_notification");
    expect(r.category).not.toBe("job_offer");
  });

  test("TC30 HackerRank no-reply sender + assessment body → assessment, NOT system_notification", () => {
    // Validates that we do NOT use a broad no-reply@ system rule.
    // no-reply@ is intentionally absent from SYSTEM_SIGNALS.
    const r = classifyEmail({
      subject: "Complete your HackerRank online assessment",
      body: "Please complete the coding assessment by July 10.",
      sender: "no-reply@hackerrank.com",
      receivedDate: "2026-06-23T10:00:00Z",
    });
    expect(r.category).toBe("assessment");
    expect(r.category).not.toBe("system_notification");
  });

  test("TC31 OTP email containing job word 'application' → otp_verification, NOT application_received", () => {
    const r = make(
      "Your OTP for the Workday application",
      "Your one-time password is 334421. Do not share this code.",
      "workday@notifications.com"
    );
    expect(r.category).toBe("otp_verification");
    expect(r.category).not.toBe("application_received");
  });
});
