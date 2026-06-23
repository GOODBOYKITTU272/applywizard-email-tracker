import { describe, test, expect } from "vitest";
import {
  classifyApplications,
  sortByPriority,
  JOB_CATEGORIES,
  REVIEW_CATEGORIES,
  ClassifiedApplication,
} from "./classifyMockEmails";
import { mockApplications } from "@/lib/mockData";

const classified = classifyApplications(mockApplications);

// ── Adapter fundamentals ──────────────────────────────────────────────────

describe("classifyApplications adapter", () => {
  test("returns same count as input", () => {
    expect(classified).toHaveLength(mockApplications.length);
  });

  test("does not mutate original mockApplications", () => {
    const original = mockApplications[0].category;
    expect(mockApplications[0].category).toBe(original);
  });

  test("every record has a derived object with required fields", () => {
    for (const app of classified) {
      expect(app.derived).toBeDefined();
      expect(typeof app.derived.category).toBe("string");
      expect(typeof app.derived.confidence).toBe("number");
      expect(typeof app.derived.needs_human_review).toBe("boolean");
      expect(["critical", "high", "normal", "low"]).toContain(
        app.derived.priority
      );
    }
  });

  test("interview invite (app1/Google) → interview_invite, needs_human_review true", () => {
    const app1 = classified.find((a) => a.id === "app1")!;
    expect(app1.derived.category).toBe("interview_invite");
    expect(app1.derived.needs_human_review).toBe(true);
    expect(["critical", "high"]).toContain(app1.derived.priority);
  });

  test("assessment (app2/Meta) → assessment, high", () => {
    const app2 = classified.find((a) => a.id === "app2")!;
    expect(app2.derived.category).toBe("assessment");
    expect(app2.derived.needs_human_review).toBe(true);
    expect(app2.derived.priority).toBe("high");
  });

  test("rejection (app3/Amazon) → rejection, low, no review", () => {
    const app3 = classified.find((a) => a.id === "app3")!;
    expect(app3.derived.category).toBe("rejection");
    expect(app3.derived.priority).toBe("low");
    expect(app3.derived.needs_human_review).toBe(false);
  });

  test("application_received (app4/Microsoft) → normal, no review", () => {
    const app4 = classified.find((a) => a.id === "app4")!;
    expect(app4.derived.category).toBe("application_received");
    expect(app4.derived.priority).toBe("normal");
    expect(app4.derived.needs_human_review).toBe(false);
  });

  test("job offer (app8/Stripe) → critical, needs_human_review true", () => {
    const app8 = classified.find((a) => a.id === "app8")!;
    expect(app8.derived.category).toBe("job_offer");
    expect(app8.derived.priority).toBe("critical");
    expect(app8.derived.needs_human_review).toBe(true);
  });

  test("otp_verification (app9/Airbnb) → low, no review", () => {
    const app9 = classified.find((a) => a.id === "app9")!;
    expect(app9.derived.category).toBe("otp_verification");
    expect(app9.derived.priority).toBe("low");
    expect(app9.derived.needs_human_review).toBe(false);
  });

  test("email_verification (app6/Netflix) → low, no review", () => {
    const app6 = classified.find((a) => a.id === "app6")!;
    expect(app6.derived.category).toBe("email_verification");
    expect(app6.derived.needs_human_review).toBe(false);
  });

  test("account_created (app10/Oracle) → low, no review", () => {
    const app10 = classified.find((a) => a.id === "app10")!;
    expect(app10.derived.category).toBe("account_created");
    expect(app10.derived.needs_human_review).toBe(false);
  });
});

// ── System emails must NOT appear in Applications list ────────────────────

describe("Applications list filter — system emails excluded", () => {
  const jobApps = classified.filter((a) =>
    JOB_CATEGORIES.includes(a.derived.category)
  );

  test("otp_verification not in Applications list", () => {
    expect(
      jobApps.some((a) => a.derived.category === "otp_verification")
    ).toBe(false);
  });

  test("email_verification not in Applications list", () => {
    expect(
      jobApps.some((a) => a.derived.category === "email_verification")
    ).toBe(false);
  });

  test("account_created not in Applications list", () => {
    expect(
      jobApps.some((a) => a.derived.category === "account_created")
    ).toBe(false);
  });

  test("system_notification not in Applications list", () => {
    expect(
      jobApps.some((a) => a.derived.category === "system_notification")
    ).toBe(false);
  });

  test("spam_or_irrelevant not in Applications list", () => {
    expect(
      jobApps.some((a) => a.derived.category === "spam_or_irrelevant")
    ).toBe(false);
  });
});

// ── System emails must NOT appear in Review Queue ─────────────────────────

describe("Review Queue filter — system emails excluded", () => {
  const reviewItems = classified.filter(
    (a) =>
      a.derived.needs_human_review &&
      REVIEW_CATEGORIES.includes(a.derived.category)
  );

  test("otp_verification not in Review Queue", () => {
    expect(
      reviewItems.some((a) => a.derived.category === "otp_verification")
    ).toBe(false);
  });

  test("email_verification not in Review Queue", () => {
    expect(
      reviewItems.some((a) => a.derived.category === "email_verification")
    ).toBe(false);
  });

  test("account_created not in Review Queue", () => {
    expect(
      reviewItems.some((a) => a.derived.category === "account_created")
    ).toBe(false);
  });

  test("rejection not in Review Queue", () => {
    expect(
      reviewItems.some((a) => a.derived.category === "rejection")
    ).toBe(false);
  });
});

// ── Priority sort — interview with deadline before recruiter reply ─────────

describe("sortByPriority", () => {
  test("interview_invite with deadline sorts before recruiter_reply without deadline", () => {
    const items: ClassifiedApplication[] = [
      {
        ...mockApplications[0],
        derived: {
          category: "recruiter_reply",
          confidence: 0.82,
          priority: "high",
          needs_human_review: true,
          deadline: null,
          reason: "recruiter signal",
        },
      },
      {
        ...mockApplications[0],
        id: "synthetic-interview",
        derived: {
          category: "interview_invite",
          confidence: 0.93,
          priority: "critical",
          needs_human_review: true,
          deadline: "2026-06-25",
          reason: "interview signal",
        },
      },
    ];

    const sorted = sortByPriority(items);
    expect(sorted[0].derived.category).toBe("interview_invite");
    expect(sorted[1].derived.category).toBe("recruiter_reply");
  });

  test("critical before high before normal", () => {
    const base = mockApplications[0];
    const items: ClassifiedApplication[] = [
      { ...base, id: "n", derived: { category: "unknown", confidence: 0.4, priority: "normal", needs_human_review: true, deadline: null, reason: "" } },
      { ...base, id: "c", derived: { category: "job_offer", confidence: 0.95, priority: "critical", needs_human_review: true, deadline: null, reason: "" } },
      { ...base, id: "h", derived: { category: "recruiter_reply", confidence: 0.82, priority: "high", needs_human_review: true, deadline: null, reason: "" } },
    ];
    const sorted = sortByPriority(items);
    expect(sorted.map((i) => i.derived.priority)).toEqual(["critical", "high", "normal"]);
  });

  test("within same priority, earlier deadline comes first", () => {
    const base = mockApplications[0];
    const items: ClassifiedApplication[] = [
      { ...base, id: "later", derived: { category: "assessment", confidence: 0.9, priority: "high", needs_human_review: true, deadline: "2026-07-10", reason: "" } },
      { ...base, id: "earlier", derived: { category: "assessment", confidence: 0.9, priority: "high", needs_human_review: true, deadline: "2026-06-28", reason: "" } },
    ];
    const sorted = sortByPriority(items);
    expect(sorted[0].id).toBe("earlier");
  });
});
