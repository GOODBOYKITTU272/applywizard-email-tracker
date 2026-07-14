import { readFileSync } from "fs";
import { resolve } from "path";

import { describe, expect, it } from "vitest";

describe("mock status contracts", () => {
  it("does not keep failed as a current runtime queue status in mock sources", () => {
    const mockData = readFileSync(resolve(__dirname, "../mockData.ts"), "utf8");
    const appsPage = readFileSync(resolve(__dirname, "../../app/(operations)/applications/page.tsx"), "utf8");
    const reviewQueuePage = readFileSync(resolve(__dirname, "../../app/(operations)/review-queue/page.tsx"), "utf8");

    expect(mockData).not.toContain('status: "pending" | "classified" | "failed"');
    expect(mockData).not.toContain('status: "failed"');
    expect(appsPage).not.toContain('selectedStatus === "failed"');
    expect(appsPage).not.toContain('<option value="failed">');
    expect(reviewQueuePage).not.toContain('item.status === "failed"');
    expect(reviewQueuePage).not.toContain("Failed (");
  });
});
