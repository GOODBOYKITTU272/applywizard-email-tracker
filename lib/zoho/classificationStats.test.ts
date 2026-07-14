import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const queuedCounts: number[] = [];
const eqCalls: Array<[string, string | boolean]> = [];

const mockSelect = vi.fn(() => {
  const query = {
    eq: (column: string, value: string | boolean) => {
      eqCalls.push([column, value]);
      return query;
    },
    then: (resolve: (value: { count: number; error: null }) => void) =>
      resolve({ count: queuedCounts.shift() ?? 0, error: null }),
  };

  return query;
});

const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    from: mockFrom,
  }),
}));

describe("classificationStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queuedCounts.length = 0;
    eqCalls.length = 0;
  });

  it("counts review_required_count from review rows and preserves per-status counts", async () => {
    queuedCounts.push(
      4, // pending_count
      3, // processing_count
      2, // retry_scheduled_count
      10, // classified_count
      6, // review_count
      1, // dead_letter_count
      10, // total_classified
      3, // deterministic_count
      2, // regex_count
      5, // ai_count
      1, // unknown_count
      6, // review_required_count
      2, // system_notification_count
      1, // spam_or_irrelevant_count
    );

    const { getClassificationStats } = await import("./classificationStats");
    const stats = await getClassificationStats();

    expect(stats.pending_count).toBe(4);
    expect(stats.processing_count).toBe(3);
    expect(stats.retry_scheduled_count).toBe(2);
    expect(stats.classified_count).toBe(10);
    expect(stats.review_count).toBe(6);
    expect(stats.dead_letter_count).toBe(1);
    expect(stats.review_required_count).toBe(6);
    expect(eqCalls).toContainEqual(["classification_status", "review"]);
    expect(eqCalls).not.toContainEqual(["needs_human_review", true]);
  });
});
