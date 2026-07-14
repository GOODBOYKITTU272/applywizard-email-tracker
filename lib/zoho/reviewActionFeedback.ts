export type ReviewFeedbackStatus =
  | "saved"
  | "missing_category"
  | "invalid_category"
  | "row_not_found"
  | "save_failed";

export interface ReviewSubmissionBanner {
  tone: "success" | "error";
  message: string;
}

export function getReviewSubmissionBanner(
  status: ReviewFeedbackStatus | string | null | undefined,
): ReviewSubmissionBanner | null {
  switch (status) {
    case "saved":
      return { tone: "success", message: "Human review saved." };
    case "missing_category":
      return { tone: "error", message: "Choose a category before saving." };
    case "invalid_category":
      return { tone: "error", message: "Selected category is not valid." };
    case "row_not_found":
    case "save_failed":
      return { tone: "error", message: "Human review could not be saved." };
    default:
      return null;
  }
}
