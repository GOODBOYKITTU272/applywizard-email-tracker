import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("DashboardPage", () => {
  it("contains no DASHBOARD_SECRET runtime logic or copy", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/dashboard/page.tsx"), "utf8");
    expect(source).not.toContain("DASHBOARD_SECRET");
    expect(source).not.toContain("Configuration Error");
  });
});
