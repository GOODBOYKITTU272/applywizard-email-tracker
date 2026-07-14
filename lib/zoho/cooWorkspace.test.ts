import { readFileSync } from "fs";
import { resolve } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type MockRow = Record<string, unknown>;

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

function sortRows(rows: MockRow[], orderBy: null | { column: string; ascending: boolean }) {
  if (!orderBy) return rows;
  return [...rows].sort((left, right) => {
    const a = String(left[orderBy.column] ?? "");
    const b = String(right[orderBy.column] ?? "");
    return orderBy.ascending ? a.localeCompare(b) : b.localeCompare(a);
  });
}

function createSupabaseMock(emailRows: MockRow[], checkpointRows: MockRow[] = []) {
  const makeQuery = (table: string) => {
    const state = {
      filters: [] as Array<{ type: string; column: string; value: unknown }>,
      orderBy: null as null | { column: string; ascending: boolean },
      range: null as null | { start: number; end: number },
    };

    const query: Record<string, unknown> = {
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
      range(start: number, end: number) {
        state.range = { start, end };
        return query;
      },
      then(resolve: (value: { data: MockRow[]; error: null; count?: number }) => void) {
        const source = table === "zoho_email_metadata" ? emailRows : checkpointRows;
        const filtered = sortRows(applyFilters(source, state.filters), state.orderBy);
        const ranged = state.range ? filtered.slice(state.range.start, state.range.end + 1) : filtered;
        resolve({ data: ranged, error: null, count: ranged.length });
      },
    };

    return query;
  };

  return {
    from(table: string) {
      return {
        select() {
          return makeQuery(table);
        },
      };
    },
  };
}

describe("cooWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds and resolves opaque client keys without exposing raw mailbox values", async () => {
    const { buildClientKey, resolveClientRecipient } = await import("./cooWorkspace");
    const key = buildClientKey("  Client-One@Example.Test ");
    expect(key).toMatch(/^ck_v1_[A-Za-z0-9_-]+$/);
    expect(key).not.toContain("client-one");
    expect(key).not.toContain("Y2xpZW50LW9uZUBleGFtcGxlLnRlc3Q");
    expect(resolveClientRecipient(key)).toBe("client-one@example.test");
    expect(resolveClientRecipient("c_Y2xpZW50LW9uZUBleGFtcGxlLnRlc3Q")).toBeNull();
  });

  it("does not use SUPABASE_SERVICE_ROLE_KEY for client key encryption", async () => {
    const { buildClientKey, resolveClientRecipient } = await import("./cooWorkspace");
    const previousCooSecret = process.env.COO_CLIENT_KEY_SECRET;
    const previousCronSecret = process.env.CRON_SECRET;
    const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      delete process.env.COO_CLIENT_KEY_SECRET;
      delete process.env.CRON_SECRET;
      process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-one";
      const key = buildClientKey("service-role-ignored@example.test");

      process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-two";
      expect(resolveClientRecipient(key)).toBe("service-role-ignored@example.test");
    } finally {
      if (previousCooSecret === undefined) delete process.env.COO_CLIENT_KEY_SECRET;
      else process.env.COO_CLIENT_KEY_SECRET = previousCooSecret;
      if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousCronSecret;
      if (previousServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
    }
  });

  it("overview aggregates exclude dead-letter rows from business counts and keep safe fields only", async () => {
    const { getOverviewWorkspaceData } = await import("./cooWorkspace");
    const supabase = createSupabaseMock(
      [
        {
          id: "offer-1",
          original_recipient: "client-a@example.test",
          category: "job_offer",
          classification_status: "classified",
          confidence: 0.98,
          received_at: "2026-06-30T10:00:00.000Z",
          first_seen_at: "2026-06-30T10:01:00.000Z",
          created_at: "2026-06-30T10:01:00.000Z",
          classified_at: "2026-06-30T10:05:00.000Z",
          deadline: "2026-07-01",
          action_required: "Accept offer at https://unsafe.example/code 123456 client-a@example.test",
          reason: "safe reason",
          next_retry_at: null,
          dead_lettered_at: null,
          claim_expires_at: null,
          last_error_code: null,
          routing_status: "routed",
          email_direction: "inbound",
        },
        {
          id: "offer-dead",
          original_recipient: "client-a@example.test",
          category: "job_offer",
          classification_status: "dead_letter",
          confidence: 0.2,
          received_at: "2026-06-30T09:00:00.000Z",
          first_seen_at: "2026-06-30T09:01:00.000Z",
          created_at: "2026-06-30T09:01:00.000Z",
          classified_at: "2026-06-30T09:05:00.000Z",
          deadline: null,
          action_required: null,
          reason: "unsafe",
          next_retry_at: null,
          dead_lettered_at: "2026-06-30T09:10:00.000Z",
          claim_expires_at: null,
          last_error_code: "UNKNOWN_PROCESSING_ERROR",
          routing_status: "dead_letter",
          email_direction: "inbound",
        },
        {
          id: "review-1",
          original_recipient: "client-b@example.test",
          category: "unknown",
          classification_status: "review",
          confidence: 0.55,
          received_at: "2026-06-30T08:00:00.000Z",
          first_seen_at: "2026-06-30T08:01:00.000Z",
          created_at: "2026-06-30T08:01:00.000Z",
          classified_at: "2026-06-30T08:05:00.000Z",
          deadline: null,
          action_required: "Manual review",
          reason: "Classification reason redacted for safety.",
          next_retry_at: null,
          dead_lettered_at: null,
          claim_expires_at: null,
          last_error_code: null,
          routing_status: "routed",
          email_direction: "inbound",
        },
        {
          id: "pending-1",
          original_recipient: "client-c@example.test",
          category: "application_received",
          classification_status: "pending",
          confidence: null,
          received_at: "2026-06-30T07:00:00.000Z",
          first_seen_at: "2026-06-30T11:30:00.000Z",
          created_at: "2026-06-30T11:30:00.000Z",
          classified_at: null,
          deadline: null,
          action_required: null,
          reason: null,
          next_retry_at: null,
          dead_lettered_at: null,
          claim_expires_at: null,
          last_error_code: null,
          routing_status: "queued",
          email_direction: "inbound",
        },
      ],
      [
        {
          mailbox_email: "tracker@applywizard.ai",
          last_successful_sync_at: "2026-06-30T11:00:00.000Z",
        },
      ],
    );

    const data = await getOverviewWorkspaceData({
      supabase: supabase as never,
      now: new Date("2026-06-30T12:00:00.000Z"),
      mailboxEmail: "tracker@applywizard.ai",
    });

    expect(data.metrics.offers).toBe(1);
    expect(data.metrics.applications).toBe(1);
    expect(data.metrics.deadLetter).toBe(1);
    expect(data.clientRows.find((row) => row.originalRecipient === "client-a@example.test")?.offers).toBe(1);
    expect(data.clientRows.find((row) => row.originalRecipient === "client-a@example.test")?.latestMeaningfulActionRequired).not.toContain("https://unsafe.example");
    expect(data.clientRows.find((row) => row.originalRecipient === "client-a@example.test")?.latestMeaningfulActionRequired).not.toContain("client-a@example.test");
    expect(data.activityRows.find((row) => row.id === "offer-1")?.actionRequired).not.toContain("123456");
    expect(data.activityRows.every((row) => row.classificationStatus !== "dead_letter")).toBe(true);
    expect(Object.keys(data.clientRows[0] ?? {})).not.toContain("subject");
    expect(Object.keys(data.activityRows[0] ?? {})).not.toContain("body");
  });

  it("client detail and review queue rows stay safe while resolving the client key", async () => {
    const { getClientDetailWorkspaceData, getReviewQueueWorkspaceData, buildClientKey } = await import("./cooWorkspace");
    const clientKey = buildClientKey("client-review@example.test");
    const supabase = createSupabaseMock(
      [
        {
          id: "review-1",
          original_recipient: "client-review@example.test",
          category: "unknown",
          classification_status: "review",
          confidence: 0.61,
          received_at: "2026-06-30T09:00:00.000Z",
          first_seen_at: "2026-06-30T09:01:00.000Z",
          created_at: "2026-06-30T09:01:00.000Z",
          classified_at: "2026-06-30T09:10:00.000Z",
          deadline: null,
          action_required: "Manual review: contact client-review@example.test with token abcdefghijklmnopqrstuvwx",
          reason: "Classification reason redacted for safety.",
          next_retry_at: null,
          dead_lettered_at: null,
          claim_expires_at: null,
          last_error_code: null,
          routing_status: "routed",
          email_direction: "inbound",
        },
        {
          id: "classified-1",
          original_recipient: "client-review@example.test",
          category: "interview_invite",
          classification_status: "classified",
          confidence: 0.93,
          received_at: "2026-06-30T08:00:00.000Z",
          first_seen_at: "2026-06-30T08:01:00.000Z",
          created_at: "2026-06-30T08:01:00.000Z",
          classified_at: "2026-06-30T08:05:00.000Z",
          deadline: "2026-07-01",
          action_required: "Schedule interview",
          reason: null,
          next_retry_at: null,
          dead_lettered_at: null,
          claim_expires_at: null,
          last_error_code: null,
          routing_status: "routed",
          email_direction: "inbound",
        },
      ],
    );

    const detail = await getClientDetailWorkspaceData({
      supabase: supabase as never,
      now: new Date("2026-06-30T12:00:00.000Z"),
      clientKey,
      range: "today",
    });

    expect(detail?.originalRecipient).toBe("client-review@example.test");
    expect(detail?.timeline[0]?.safeReason).toBe("Classification reason redacted for safety.");
    expect(detail?.timeline[0]?.actionRequired).not.toContain("client-review@example.test");
    expect(detail?.timeline[0]?.actionRequired).not.toContain("abcdefghijklmnopqrstuvwx");
    expect(Object.keys(detail?.timeline[0] ?? {})).not.toContain("subject");
    expect(Object.keys(detail?.timeline[0] ?? {})).not.toContain("raw_headers");

    const reviewQueue = await getReviewQueueWorkspaceData({
      supabase: supabase as never,
      now: new Date("2026-06-30T12:00:00.000Z"),
    });

    expect(reviewQueue.count).toBe(1);
    expect(reviewQueue.rows).toHaveLength(1);
    expect(reviewQueue.rows[0]?.safeReason).toBe("Classification reason redacted for safety.");
    expect(reviewQueue.rows[0]?.actionRequired).not.toContain("client-review@example.test");
  });

  it("returns a valid empty client detail for a safe token with no rows in the selected range", async () => {
    const { getClientDetailWorkspaceData, buildClientKey } = await import("./cooWorkspace");
    const data = await getClientDetailWorkspaceData({
      supabase: createSupabaseMock([]) as never,
      now: new Date("2026-06-30T12:00:00.000Z"),
      clientKey: buildClientKey("empty-client@example.test"),
      range: "today",
    });

    expect(data?.originalRecipient).toBe("empty-client@example.test");
    expect(data?.hasRows).toBe(false);
    expect(data?.summary.totalEmails).toBe(0);
    expect(data?.timeline).toEqual([]);
  });

  it("operations backlog age uses first_seen_at and ignores classified/review/dead-letter rows", async () => {
    const { getOperationsWorkspaceData } = await import("./cooWorkspace");
    const supabase = createSupabaseMock([
      {
        id: "pending-1",
        original_recipient: "client-age@example.test",
        category: "application_received",
        classification_status: "pending",
        confidence: null,
        received_at: "2026-06-23T09:00:00.000Z",
        first_seen_at: "2026-06-30T11:45:00.000Z",
        created_at: "2026-06-30T11:45:00.000Z",
        classified_at: null,
        deadline: null,
        action_required: null,
        reason: null,
        next_retry_at: null,
        dead_lettered_at: null,
        claim_expires_at: null,
        last_error_code: null,
        routing_status: "queued",
        email_direction: "inbound",
      },
      {
        id: "classified-old",
        original_recipient: "client-age@example.test",
        category: "job_offer",
        classification_status: "classified",
        confidence: 0.95,
        received_at: "2026-06-01T09:00:00.000Z",
        first_seen_at: "2026-06-01T09:00:00.000Z",
        created_at: "2026-06-01T09:00:00.000Z",
        classified_at: "2026-06-01T09:10:00.000Z",
        deadline: null,
        action_required: null,
        reason: null,
        next_retry_at: null,
        dead_lettered_at: null,
        claim_expires_at: null,
        last_error_code: null,
        routing_status: "routed",
        email_direction: "inbound",
      },
      {
        id: "review-old",
        original_recipient: "client-age@example.test",
        category: "unknown",
        classification_status: "review",
        confidence: 0.52,
        received_at: "2026-06-01T09:00:00.000Z",
        first_seen_at: "2026-06-01T09:00:00.000Z",
        created_at: "2026-06-01T09:00:00.000Z",
        classified_at: "2026-06-01T09:10:00.000Z",
        deadline: null,
        action_required: null,
        reason: "Classification reason redacted for safety.",
        next_retry_at: null,
        dead_lettered_at: null,
        claim_expires_at: null,
        last_error_code: null,
        routing_status: "routed",
        email_direction: "inbound",
      },
      {
        id: "dead-old",
        original_recipient: "client-age@example.test",
        category: "unknown",
        classification_status: "dead_letter",
        confidence: 0.2,
        received_at: "2026-06-01T09:00:00.000Z",
        first_seen_at: "2026-06-01T09:00:00.000Z",
        created_at: "2026-06-01T09:00:00.000Z",
        classified_at: "2026-06-01T09:10:00.000Z",
        deadline: null,
        action_required: null,
        reason: null,
        next_retry_at: null,
        dead_lettered_at: "2026-06-01T09:30:00.000Z",
        claim_expires_at: null,
        last_error_code: "RAW provider stack trace with https://unsafe.example",
        routing_status: "dead_letter",
        email_direction: "inbound",
      },
    ]);

    const data = await getOperationsWorkspaceData({
      supabase: supabase as never,
      now: new Date("2026-06-30T12:00:00.000Z"),
      mailboxEmail: "tracker@applywizard.ai",
    });

    expect(data.oldestBacklogAgeMinutes).toBe(15);
    expect(data.review).toBe(1);
    expect(data.deadLetter).toBe(1);
    expect(data.oldestPending[0]?.queueStatus).toBe("pending");
    expect(data.deadLetterRows[0]?.lastErrorCode).toBe("UNKNOWN_PROCESSING_ERROR");
  });

  it("navigation keeps CA Portfolio hidden from the live COO shell", () => {
    const layout = readFileSync(resolve(__dirname, "../../app/(operations)/layout.tsx"), "utf8");
    expect(layout).not.toContain("CA Portfolio");
    expect(layout).not.toContain("IconCAPortfolio");
  });

  it("keeps mobile card stats styling in the shared COO page styles only", () => {
    const layout = readFileSync(resolve(__dirname, "../../app/(operations)/layout.tsx"), "utf8");
    const styles = readFileSync(resolve(__dirname, "../../components/coo-page-styles.tsx"), "utf8");
    expect(layout).not.toContain(".coo-mobile-card__stats");
    expect(styles.match(/\.coo-mobile-card__stats/g)).toHaveLength(1);
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(styles).toContain(".coo-dual-grid");
    expect(styles).toContain(".coo-flow");
  });
});

describe("effectiveCategory / human correction in dashboard counts", () => {
  it("counts a row under its human-corrected category, not the AI's original category", async () => {
    const emailRows = [
      {
        id: "row-1",
        original_recipient: "client@applywizard.ai",
        category: "interview_invite",
        human_category: "recruiter_reply",
        classification_status: "classified",
        confidence: 0.9,
        priority: "high",
        received_at: "2026-07-08T00:00:00.000Z",
        first_seen_at: "2026-07-08T00:00:00.000Z",
        created_at: "2026-07-08T00:00:00.000Z",
        classified_at: "2026-07-08T00:00:00.000Z",
        deadline: null,
        action_required: null,
        reason: null,
        next_retry_at: null,
        dead_lettered_at: null,
        claim_expires_at: null,
        last_error_code: null,
        routing_status: "routed",
        email_direction: "inbound",
      },
    ];

    const supabase = createSupabaseMock(emailRows, [
      { mailbox_email: "tracker@applywizard.ai", last_successful_sync_at: "2026-07-08T00:00:00.000Z" },
    ]);
    const { getOverviewWorkspaceData } = await import("./cooWorkspace");

    // getOverviewWorkspaceData takes the mock Supabase client as a direct
    // function argument (dependency injection), not via vi.mock — this is
    // the same convention every other test in this file already uses.
    const data = await getOverviewWorkspaceData({
      supabase: supabase as never,
      now: new Date("2026-07-08T12:00:00.000Z"),
      mailboxEmail: "tracker@applywizard.ai",
    });

    expect(data.metrics.interviews).toBe(0);
    expect(data.metrics.recruiterReplies).toBe(1);
  });
});
