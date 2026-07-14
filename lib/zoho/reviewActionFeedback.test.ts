import { describe, expect, it } from "vitest";

import { getReviewSubmissionBanner } from "./reviewActionFeedback";

describe("getReviewSubmissionBanner", () => {
  it("returns a success banner for saved reviews", () => {
    expect(getReviewSubmissionBanner("saved")).toEqual({
      tone: "success",
      message: "Human review saved.",
    });
  });

  it("returns a safe error banner for missing categories", () => {
    expect(getReviewSubmissionBanner("missing_category")).toEqual({
      tone: "error",
      message: "Choose a category before saving.",
    });
  });

  it("returns null for unknown status values", () => {
    expect(getReviewSubmissionBanner("anything_else")).toBeNull();
  });
});
