import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sensitiveApiRoutes = [
  "app/api/classify/test/route.ts",
  "app/api/zoho/emails/classify/test/route.ts",
  "app/api/zoho/emails/sync/test/route.ts",
  "app/api/zoho/emails/test/route.ts",
  "app/api/zoho/emails/test/[messageId]/route.ts",
  "app/api/zoho/workflow/test/route.ts",
] as const;

describe("sensitive operational API role coverage", () => {
  it.each(sensitiveApiRoutes)("%s requires exactly admin_ceo", (filePath) => {
    const source = fs.readFileSync(path.join(process.cwd(), filePath), "utf8");

    expect(source).toContain('requireApiRole(request, ["admin_ceo"])');
    expect(source).not.toContain("manager_ops");
    expect(source).not.toContain('"ca"');
  });
});
