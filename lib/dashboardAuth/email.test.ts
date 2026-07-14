import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("normalizeEmail", () => {
  it("trims and lowercases email values", async () => {
    const { normalizeEmail } = await import("./email");

    expect(normalizeEmail("  Staff.Member@ApplyWizz.AI  ")).toBe("staff.member@applywizz.ai");
  });
});
