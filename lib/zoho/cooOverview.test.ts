import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import { SAFE_REASON_FALLBACK } from "@/lib/classify/sanitizeReason";

vi.mock("server-only", () => ({}));

type MockRow = Record<string, unknown>;
type QueryMock = {
  eq(column: string, value: unknown): QueryMock;
  gte(column: string, value: unknown): QueryMock;
  lt(column: string, value: unknown): QueryMock;
  in(column: string, value: unknown[]): QueryMock;
  order(column: string, opts?: { ascending?: boolean }): QueryMock;
  limit(count: number): Promise<{ data: MockRow[]; error: null }>;
  maybeSingle(): Promise<{ data: MockRow | MockRow[] | null; error: null }>;
  then(
    resolve: (value: { count?: number; data?: MockRow[]; error: null }) => void,
  ): Promise<void>;
};

function applyFilters(rows: MockRow[], filters: Array<{ type: string; column: string; value: unknown }>) {
  return rows.filter((row) =>
    filters.every((filter) => {
      const value = row[filter.column];
      if (filter.type === "eq") return value === filter.value;
      if (filter.type === "gte") return String(value ?? "") >= String(filter.value ?? "");
      if (filter.type === "lt") return String(value ?? "") < String(filter.value ?? "");
      if (filter.type === "in") {
        return Array.isArray(filter.value) && filter.value.includes(value);
      }
      return true;
    }),
  );
}

function createSupabaseMock(emailRows: MockRow[], checkpointRow: MockRow | null) {
  const countsRequested: Array<{ table: string; filters: Array<{ type: string; column: string; value: unknown }> }> = [];

  const makeQuery = (table: string, _head = false) => {
    void _head;
    const state = {
      filters: [] as Array<{ type: string; column: string; value: unknown }>,
      orderBy: null as null | { column: string; ascending: boolean },
      limitCount: null as null | number,
    };

    const query: QueryMock = {
      eq(column: string, value: unknown) {
        state.filters.push({ type: "eq", column, value });
        return query;
      },
      gte(column: string, value: unknown) {
        state.filters.push({ type: "gte", column, value });
        return query;
      },
      lt(column: string, value: unknown) {
        state.filters.push({ type: "lt", column, value });
        return query;
      },
      in(column: string, value: unknown[]) {
        state.filters.push({ type: "in", column, value });
        return query;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        state.orderBy = { column, ascending: opts?.ascending !== false };
        return query;
      },
      limit(count: number) {
        state.limitCount = count;
        const rows = applyFilters(table === "zoho_email_metadata" ? emailRows : checkpointRow ? [checkpointRow] : [], state.filters);
        const sorted = state.orderBy
          ? [...rows].sort((a, b) => {
              const left = String(a[state.orderBy!.column] ?? "");
              const right = String(b[state.orderBy!.column] ?? "");
              return state.orderBy!.ascending ? left.localeCompare(right) : right.localeCompare(left);
            })
          : rows;
        return Promise.resolve({ data: sorted.slice(0, count), error: null });
      },
      maybeSingle() {
        const rows = applyFilters(table === "zoho_email_metadata" ? emailRows : checkpointRow ? [checkpointRow] : [], state.filters);
        const sorted = state.orderBy
          ? [...rows].sort((a, b) => {
              const left = String(a[state.orderBy!.column] ?? "");
              const right = String(b[state.orderBy!.column] ?? "");
              return state.orderBy!.ascending ? left.localeCompare(right) : right.localeCompare(left);
            })
          : rows;
        return Promise.resolve({ data: sorted[0] ?? null, error: null });
      },
      then(resolve: (value: { count?: number; data?: MockRow[]; error: null }) => void) {
        countsRequested.push({ table, filters: state.filters.slice() });
        const rows = applyFilters(table === "zoho_email_metadata" ? emailRows : checkpointRow ? [checkpointRow] : [], state.filters);
        resolve({ count: rows.length, error: null });
      },
    };

    return query;
  };

  const supabase = {
    from(table: string) {
      return {
        select(_: string, options?: { count?: string; head?: boolean }) {
          return makeQuery(table, Boolean(options?.head));
        },
      };
    },
  };

  return { supabase, countsRequested };
}

describe("getOverviewDashboardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns live overview aggregates from received_at and classified_at", async () => {
    const { supabase } = createSupabaseMock(
      [
        {
          id: "row-offer",
          original_recipient: "client1@example.test",
          category: "job_offer",
          classification_status: "classified",
          confidence: 0.98,
          received_at: "2026-06-30T09:00:00.000Z",
          classified_at: "2026-06-30T10:00:00.000Z",
          deadline: "2026-07-02",
          action_required: "Accept offer",
          reason: "Safe review reason",
          subject: "hidden subject",
          body: "hidden body",
          raw_headers: "hidden headers",
        },
        {
          id: "row-interview",
          original_recipient: "client2@example.test",
          category: "interview_invite",
          classification_status: "classified",
          confidence: 0.94,
          received_at: "2026-06-30T08:30:00.000Z",
          classified_at: "2026-06-30T10:15:00.000Z",
          deadline: null,
          action_required: "Prepare interview",
          reason: null,
          subject: "hidden subject",
          body: "hidden body",
          raw_headers: "hidden headers",
        },
        {
          id: "row-assessment",
          original_recipient: "client3@example.test",
          category: "assessment",
          classification_status: "review",
          confidence: 0.84,
          received_at: "2026-06-30T07:15:00.000Z",
          classified_at: "2026-06-29T23:59:00.000Z",
          deadline: "2026-07-01",
          action_required: "Complete assessment",
          reason: "Classification reason redacted for safety.",
          subject: "hidden subject",
          body: "hidden body",
          raw_headers: "hidden headers",
        },
        {
          id: "row-reply",
          original_recipient: "client4@example.test",
          category: "recruiter_reply",
          classification_status: "classified",
          confidence: 0.88,
          received_at: "2026-06-30T06:10:00.000Z",
          classified_at: "2026-06-30T06:20:00.000Z",
          deadline: null,
          action_required: "Reply to recruiter",
          reason: null,
          subject: "hidden subject",
          body: "hidden body",
          raw_headers: "hidden headers",
        },
        {
          id: "row-followup",
          original_recipient: "client5@example.test",
          category: "follow_up_needed",
          classification_status: "classified",
          confidence: 0.81,
          received_at: "2026-06-30T05:05:00.000Z",
          classified_at: "2026-06-30T05:15:00.000Z",
          deadline: null,
          action_required: "Follow up",
          reason: null,
          subject: "hidden subject",
          body: "hidden body",
          raw_headers: "hidden headers",
        },
        {
          id: "row-review",
          original_recipient: "client6@example.test",
          category: "unknown",
          classification_status: "review",
          confidence: 0.61,
          received_at: "2026-06-30T04:00:00.000Z",
          classified_at: "2026-06-30T04:30:00.000Z",
          deadline: null,
          action_required: "Manual review",
          reason: "Classification reason redacted for safety.",
          subject: "hidden subject",
          body: "hidden body",
          raw_headers: "hidden headers",
        },
        {
          id: "row-pending",
          original_recipient: "client7@example.test",
          category: "application_received",
          classification_status: "pending",
          confidence: null,
          received_at: "2026-06-30T03:00:00.000Z",
          first_seen_at: "2026-06-30T11:00:00.000Z",
          created_at: "2026-06-30T11:00:00.000Z",
          classified_at: null,
          deadline: null,
          action_required: null,
          reason: null,
          subject: "hidden subject",
          body: "hidden body",
          raw_headers: "hidden headers",
        },
        {
          id: "row-spam",
          original_recipient: "client8@example.test",
          category: "spam_or_irrelevant",
          classification_status: "classified",
          confidence: 0.9,
          received_at: "2026-06-30T02:00:00.000Z",
          classified_at: "2026-06-30T02:15:00.000Z",
          deadline: null,
          action_required: null,
          reason: null,
          subject: "hidden subject",
          body: "hidden body",
          raw_headers: "hidden headers",
        },
        {
          id: "row-otp",
          original_recipient: "client9@example.test",
          category: "otp_verification",
          classification_status: "classified",
          confidence: 0.99,
          received_at: "2026-06-30T01:00:00.000Z",
          classified_at: "2026-06-30T01:10:00.000Z",
          deadline: null,
          action_required: null,
          reason: null,
          subject: "hidden subject",
          body: "hidden body",
          raw_headers: "hidden headers",
        },
        {
          id: "row-yesterday-classified",
          original_recipient: "client10@example.test",
          category: "job_offer",
          classification_status: "classified",
          confidence: 0.93,
          received_at: "2026-06-29T23:30:00.000Z",
          classified_at: "2026-06-30T09:30:00.000Z",
          deadline: null,
          action_required: "Offer accepted",
          reason: null,
          subject: "hidden subject",
          body: "hidden body",
          raw_headers: "hidden headers",
        },
      ],
      [
        {
          mailbox_email: "tracker@applywizard.ai",
          last_successful_sync_at: "2026-06-30T11:45:00.000Z",
        },
      ],
    );

    const { getOverviewDashboardData } = await import("./cooOverview");
    const data = await getOverviewDashboardData({
      supabase: supabase as never,
      now: new Date("2026-06-30T12:00:00.000Z"),
      mailboxEmail: "tracker@applywizard.ai",
    });

    expect(data.metrics.emailsReceivedToday).toBe(9);
    expect(data.metrics.applicationReceivedToday).toBe(1);
    expect(data.metrics.interviewInviteToday).toBe(1);
    expect(data.metrics.assessmentToday).toBe(1);
    expect(data.metrics.jobOfferToday).toBe(2);
    expect(data.metrics.rejectionToday).toBe(0);
    expect(data.metrics.recruiterReplyToday).toBe(1);
    expect(data.metrics.followUpNeededToday).toBe(1);
    expect(data.metrics.classifiedToday).toBe(6);
    expect(data.queue.pending).toBe(1);
    expect(data.queue.processing).toBe(0);
    expect(data.queue.retryScheduled).toBe(0);
    expect(data.queue.review).toBe(2);
    expect(data.queue.deadLetter).toBe(0);
    expect(data.queue.oldestBacklogAgeMinutes).toBeGreaterThan(0);
    expect(data.queue.latestSuccessfulIngestAt).toBe("2026-06-30T11:45:00.000Z");
  });

  it("orders important activity by offer, interview, assessment, recruiter reply/follow-up, then review", async () => {
    const { supabase } = createSupabaseMock(
      [
        {
          id: "row-followup",
          original_recipient: "client5@example.test",
          category: "follow_up_needed",
          classification_status: "classified",
          confidence: 0.81,
          received_at: "2026-06-30T05:05:00.000Z",
          classified_at: "2026-06-30T05:15:00.000Z",
          deadline: null,
          action_required: "Follow up",
          reason: null,
        },
        {
          id: "row-review",
          original_recipient: "client6@example.test",
          category: "unknown",
          classification_status: "review",
          confidence: 0.61,
          received_at: "2026-06-30T04:00:00.000Z",
          classified_at: "2026-06-30T04:30:00.000Z",
          deadline: null,
          action_required: "Manual review",
          reason: SAFE_REASON_FALLBACK,
        },
        {
          id: "row-reply",
          original_recipient: "client4@example.test",
          category: "recruiter_reply",
          classification_status: "classified",
          confidence: 0.88,
          received_at: "2026-06-30T06:10:00.000Z",
          classified_at: "2026-06-30T06:20:00.000Z",
          deadline: null,
          action_required: "Reply to recruiter",
          reason: null,
        },
        {
          id: "row-assessment",
          original_recipient: "client3@example.test",
          category: "assessment",
          classification_status: "review",
          confidence: 0.84,
          received_at: "2026-06-30T07:15:00.000Z",
          classified_at: "2026-06-29T23:59:00.000Z",
          deadline: "2026-07-01",
          action_required: "Complete assessment",
          reason: SAFE_REASON_FALLBACK,
        },
        {
          id: "row-interview",
          original_recipient: "client2@example.test",
          category: "interview_invite",
          classification_status: "classified",
          confidence: 0.94,
          received_at: "2026-06-30T08:30:00.000Z",
          classified_at: "2026-06-30T10:15:00.000Z",
          deadline: null,
          action_required: "Prepare interview",
          reason: null,
        },
        {
          id: "row-offer",
          original_recipient: "client1@example.test",
          category: "job_offer",
          classification_status: "classified",
          confidence: 0.98,
          received_at: "2026-06-30T09:00:00.000Z",
          classified_at: "2026-06-30T10:00:00.000Z",
          deadline: "2026-07-02",
          action_required: "Accept offer",
          reason: null,
        },
        {
          id: "row-spam",
          original_recipient: "client8@example.test",
          category: "spam_or_irrelevant",
          classification_status: "classified",
          confidence: 0.9,
          received_at: "2026-06-30T02:00:00.000Z",
          classified_at: "2026-06-30T02:15:00.000Z",
          deadline: null,
          action_required: null,
          reason: null,
        },
      ],
      [],
    );

    const { getOverviewDashboardData } = await import("./cooOverview");
    const data = await getOverviewDashboardData({
      supabase: supabase as never,
      now: new Date("2026-06-30T12:00:00.000Z"),
      mailboxEmail: "tracker@applywizard.ai",
    });

    expect(data.importantActivity.map((item) => item.category)).toEqual([
      "job_offer",
      "interview_invite",
      "assessment",
      "recruiter_reply",
      "follow_up_needed",
      "unknown",
    ]);
    expect(data.importantActivity.every((item) => !("subject" in item))).toBe(true);
    expect(data.importantActivity.every((item) => !("body" in item))).toBe(true);
    expect(data.importantActivity.every((item) => !("rawHeaders" in item))).toBe(true);
  });

  it("returns safe reason only for review rows and null latest ingest when checkpoint is missing", async () => {
    const { supabase } = createSupabaseMock(
      [
        {
          id: "row-review",
          original_recipient: "client6@example.test",
          category: "unknown",
          classification_status: "review",
          confidence: 0.61,
          received_at: "2026-06-30T04:00:00.000Z",
          classified_at: "2026-06-30T04:30:00.000Z",
          deadline: null,
          action_required: "Manual review",
          reason: SAFE_REASON_FALLBACK,
          body: "hidden body",
          verification_link: "https://unsafe.test",
        },
      ],
      null,
    );

    const { getOverviewDashboardData } = await import("./cooOverview");
    const data = await getOverviewDashboardData({
      supabase: supabase as never,
      now: new Date("2026-06-30T12:00:00.000Z"),
      mailboxEmail: "tracker@applywizard.ai",
    });

    const reviewItem = data.importantActivity.find((item) => item.classificationStatus === "review");
    expect(reviewItem?.safeReason).toBe(SAFE_REASON_FALLBACK);
    expect(reviewItem).not.toHaveProperty("body");
    expect(reviewItem).not.toHaveProperty("verification_link");
    expect(data.queue.latestSuccessfulIngestAt).toBeNull();
  });

  it("uses first_seen_at instead of received_at for backlog age", async () => {
    const { supabase } = createSupabaseMock(
      [
        {
          id: "row-old-mail",
          original_recipient: "client-old@example.test",
          category: "application_received",
          classification_status: "pending",
          confidence: null,
          received_at: "2026-06-23T03:00:00.000Z",
          first_seen_at: "2026-06-30T11:00:00.000Z",
          created_at: "2026-06-30T11:00:00.000Z",
          classified_at: null,
          deadline: null,
          action_required: null,
          reason: null,
        },
      ],
      null,
    );

    const { getOverviewDashboardData } = await import("./cooOverview");
    const data = await getOverviewDashboardData({
      supabase: supabase as never,
      now: new Date("2026-06-30T12:00:00.000Z"),
      mailboxEmail: "tracker@applywizard.ai",
    });

    expect(data.queue.oldestBacklogAgeMinutes).toBe(60);
  });

  it("ignores classified, review, and dead_letter rows for backlog age", async () => {
    const { supabase } = createSupabaseMock(
      [
        {
          id: "row-pending",
          original_recipient: "client-pending@example.test",
          category: "application_received",
          classification_status: "pending",
          confidence: null,
          received_at: "2026-06-20T00:00:00.000Z",
          first_seen_at: "2026-06-30T11:30:00.000Z",
          created_at: "2026-06-30T11:30:00.000Z",
          classified_at: null,
          deadline: null,
          action_required: null,
          reason: null,
        },
        {
          id: "row-classified",
          original_recipient: "client-classified@example.test",
          category: "job_offer",
          classification_status: "classified",
          confidence: 0.95,
          received_at: "2026-06-01T00:00:00.000Z",
          first_seen_at: "2026-06-01T00:00:00.000Z",
          created_at: "2026-06-01T00:00:00.000Z",
          classified_at: "2026-06-01T01:00:00.000Z",
          deadline: null,
          action_required: null,
          reason: null,
        },
        {
          id: "row-review",
          original_recipient: "client-review@example.test",
          category: "unknown",
          classification_status: "review",
          confidence: 0.55,
          received_at: "2026-06-01T00:00:00.000Z",
          first_seen_at: "2026-06-01T00:00:00.000Z",
          created_at: "2026-06-01T00:00:00.000Z",
          classified_at: "2026-06-01T01:00:00.000Z",
          deadline: null,
          action_required: null,
          reason: SAFE_REASON_FALLBACK,
        },
        {
          id: "row-dead-letter",
          original_recipient: "client-dead@example.test",
          category: "unknown",
          classification_status: "dead_letter",
          confidence: 0.2,
          received_at: "2026-06-01T00:00:00.000Z",
          first_seen_at: "2026-06-01T00:00:00.000Z",
          created_at: "2026-06-01T00:00:00.000Z",
          classified_at: "2026-06-01T01:00:00.000Z",
          deadline: null,
          action_required: null,
          reason: null,
        },
      ],
      null,
    );

    const { getOverviewDashboardData } = await import("./cooOverview");
    const data = await getOverviewDashboardData({
      supabase: supabase as never,
      now: new Date("2026-06-30T12:00:00.000Z"),
      mailboxEmail: "tracker@applywizard.ai",
    });

    expect(data.queue.oldestBacklogAgeMinutes).toBe(30);
    expect(data.queue.review).toBe(1);
    expect(data.queue.deadLetter).toBe(1);
  });

  it("does not expose CA Portfolio in the operations navigation source", () => {
    // The nav links now live in the client shell the server layout renders.
    const layout = readFileSync(
      resolve(__dirname, "../../components/operations/operations-shell-client.tsx"),
      "utf8",
    );
    expect(layout).not.toContain("CA Portfolio");
    expect(layout).not.toContain("IconCAPortfolio");
  });
});
