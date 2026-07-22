import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const guardedPages = [
  ["dashboard", "app/dashboard/page.tsx"],
  ["overview", "app/(operations)/overview/page.tsx"],
  ["live monitor", "app/(operations)/live-monitor/email-arrival/page.tsx"],
  ["clients", "app/(operations)/clients/page.tsx"],
  ["client detail", "app/(operations)/clients/[clientKey]/page.tsx"],
  ["operations", "app/(operations)/operations/page.tsx"],
  ["interviews", "app/(operations)/operations/interviews/page.tsx"],
  ["interview detail", "app/(operations)/operations/interviews/[id]/page.tsx"],
  ["review queue", "app/(operations)/review-queue/page.tsx"],
  ["applications", "app/(operations)/applications/page.tsx"],
  ["application detail", "app/(operations)/applications/[applicationId]/page.tsx"],
  ["mailboxes", "app/(operations)/mailboxes/page.tsx"],
  ["ca portfolio", "app/(operations)/ca-portfolio/page.tsx"],
] as const;

const clientWrapperPages = [
  "app/(operations)/applications/page.tsx",
  "app/(operations)/applications/[applicationId]/page.tsx",
  "app/(operations)/mailboxes/page.tsx",
  "app/(operations)/ca-portfolio/page.tsx",
] as const;

describe("dashboard session route guard coverage", () => {
  it.each(guardedPages)("%s page calls the authoritative dashboard session guard", (_label, filePath) => {
    const source = read(filePath);

    expect(source).toContain("@/lib/dashboardAuth/requireDashboardSession");
    expect(source).toContain("requireDashboardSession()");
  });

  it.each(clientWrapperPages)("%s is a server wrapper, not an unguarded client page", (filePath) => {
    const source = read(filePath).trimStart();

    expect(source.startsWith('"use client"')).toBe(false);
    expect(source.startsWith("'use client'")).toBe(false);
    expect(source).toContain("requireDashboardSession()");
  });

  it("also guards at the operations layout, in addition to each page's own check", () => {
    // The layout now calls requireDashboardSession() too (defense-in-depth,
    // and the source of the real signed-in identity for the sidebar), but
    // this is additive: every page above still carries its own guard, so no
    // route depends on the layout as its *sole* protection.
    const source = read("app/(operations)/layout.tsx");

    expect(source).toContain("@/lib/dashboardAuth/requireDashboardSession");
    expect(source).toContain("requireDashboardSession()");
  });

  it("keeps middleware free of server-only session validation imports", () => {
    const source = read("middleware.ts");

    expect(source).not.toContain("getDashboardSessionByToken");
    expect(source).not.toContain("requireDashboardSession");
    expect(source).not.toContain("sessionStore");
  });

  it("adds a hard-navigation logout action to the operations shell", () => {
    // The logout button and its handler live in the client shell that the
    // server layout renders (components/operations/operations-shell-client.tsx),
    // not in the layout file itself.
    const source = read("components/operations/operations-shell-client.tsx");

    expect(source).toContain("/api/dashboard/auth/logout");
    expect(source).toContain("window.location.assign");
    expect(source).toContain("/dashboard/login");
  });
});
