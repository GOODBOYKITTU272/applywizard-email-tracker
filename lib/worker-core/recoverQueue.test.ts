import { describe, expect, it } from "vitest";

import { recoverQueue } from "@/lib/worker-core/recoverQueue";

describe("recoverQueue", () => {
  it("reports stale-claim recovery as part of the atomic classify claim cycle", async () => {
    await expect(recoverQueue()).resolves.toEqual({
      checked: false,
      recovered: null,
      mode: "claim-cycle",
      note: "No standalone recovery job ran. Expired processing claims are reclaimed atomically by classifyQueue through claim_zoho_email_rows.",
    });
  });
});
