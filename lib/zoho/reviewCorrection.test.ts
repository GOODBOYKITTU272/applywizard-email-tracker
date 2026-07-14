import { beforeEach, describe, expect, it, vi } from "vitest";

function makeSupabase(existingRow: Record<string, unknown> | null) {
  const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  return {
    update,
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: existingRow, error: null }),
          }),
        }),
        update,
      }),
    },
  };
}

let mockSupabase: ReturnType<typeof makeSupabase>;

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => mockSupabase.client,
}));

const EXISTING_ROW = { id: "row-1", category: "interview_invite", classification_status: "classified" };

describe("submitReviewDecision", () => {
  beforeEach(() => {
    mockSupabase = makeSupabase(EXISTING_ROW);
  });

  it("confirm: sets human_category equal to the AI category and classification_status to classified", async () => {
    const { submitReviewDecision } = await import("./reviewCorrection");
    const result = await submitReviewDecision({
      id: "row-1",
      decision: "confirm",
      reviewedBy: "admin",
    });

    expect(result).toEqual({ ok: true });
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        human_category: "interview_invite",
        classification_status: "classified",
        reviewed_by: "admin",
      }),
    );
  });

  it("change_category: sets human_category to the picked value and validates it", async () => {
    const { submitReviewDecision } = await import("./reviewCorrection");
    const result = await submitReviewDecision({
      id: "row-1",
      decision: "change_category",
      newCategory: "spam_or_irrelevant",
      reviewedBy: "admin",
    });

    expect(result).toEqual({ ok: true });
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ human_category: "spam_or_irrelevant", classification_status: "classified" }),
    );
  });

  it("rejects an invalid category value without writing anything", async () => {
    const { submitReviewDecision } = await import("./reviewCorrection");
    const result = await submitReviewDecision({
      id: "row-1",
      decision: "change_category",
      newCategory: "not_a_real_category",
      reviewedBy: "admin",
    });

    expect(result).toEqual({ ok: false, code: "INVALID_CATEGORY" });
    expect(mockSupabase.update).not.toHaveBeenCalled();
  });

  it("send_to_review: sets classification_status to review, leaves human_category unset", async () => {
    const { submitReviewDecision } = await import("./reviewCorrection");
    const result = await submitReviewDecision({
      id: "row-1",
      decision: "send_to_review",
      reviewedBy: "admin",
    });

    expect(result).toEqual({ ok: true });
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ classification_status: "review" }),
    );
    expect(mockSupabase.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ human_category: expect.anything() }),
    );
  });

  it("redacts correction_reason the same way as an AI reason", async () => {
    const { submitReviewDecision } = await import("./reviewCorrection");
    await submitReviewDecision({
      id: "row-1",
      decision: "change_category",
      newCategory: "rejection",
      correctionReason: "Confirmed via https://internal.test/notes and code 998877",
      reviewedBy: "admin",
    });

    const call = mockSupabase.update.mock.calls[0][0] as Record<string, unknown>;
    expect(String(call.correction_reason)).not.toContain("internal.test");
    expect(String(call.correction_reason)).not.toContain("998877");
  });

  it("rejects when the row does not exist (anti-tampering)", async () => {
    mockSupabase = makeSupabase(null);

    const { submitReviewDecision } = await import("./reviewCorrection");
    const result = await submitReviewDecision({ id: "missing", decision: "confirm", reviewedBy: "admin" });

    expect(result).toEqual({ ok: false, code: "ROW_NOT_FOUND" });
  });
});
