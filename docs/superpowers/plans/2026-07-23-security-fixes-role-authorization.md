# Security Fixes: Role Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two real security gaps found by review of the dashboard-auth-landing-experience branch: (1) every operations page and layout currently checks only session *presence*, never *role*, so an authenticated CA can directly navigate to any broad operations URL and see company-wide data; (2) six Zoho/classification "manual trigger" API routes have zero authentication at all and can sync mailboxes, run paid AI classification, or fetch real email content for anyone who knows the URL.

**Architecture:** Add one pure role-check function (extend the existing, currently-unused `canAccessBroadDashboards`), one server-component guard (`requireOperationsAccess()`, layered on the existing `requireDashboardSession()`), and one route-handler guard (`requireApiRole()`, new — no equivalent exists yet for Route Handlers, only for Server Components). Apply the server-component guard at the shared `(operations)` layout **and** at every individual page (defense in depth — verified in the prior branch that relying on the layout alone is not enough once someone bypasses it). Apply the route-handler guard to the six unauthenticated API routes, gated to `admin_ceo` since they are documented manual admin tools (confirmed via `CHECKPOINT.md`, not orphaned dead code). Remove the now dead-code-only `middleware.ts` entirely. Remove stale `DASHBOARD_SECRET` logic from `app/dashboard/page.tsx`.

**Tech Stack:** Next.js App Router, React Server Components, Vitest.

## Global Constraints

- Only three roles exist: `admin_ceo`, `manager_ops`, `ca`.
- Admin and manager may access all currently-approved broad operations routes for this release (manager-to-CA scoping is a separate future task, out of scope here).
- CA must never reach broad operations data through any route, direct URL entry included. CA is redirected to `/access-pending`.
- `/access-pending` itself only requires a valid session (any role) and exposes no operational data.
- Authorization must be server-side and re-checked on every request — never inferred from redirects alone, sidebar visibility, client state, or local storage.
- Never log OTP values, TOTP secrets, session tokens, or cookies.
- Do not remove any other existing check (origin checks, rate limits, input validation, the CRON_SECRET check on `/api/zoho/workflow/cron`) while adding these guards.
- Do not implement CA-level data scoping, manager-to-CA Router mapping, Zoho ingestion changes, or Production deployment.
- Do not push, merge, or deploy. Work happens only on `feature/dashboard-auth-landing-experience` (already the current branch — do not create a new branch, do not amend the 15 existing commits).

---

## Current Behavior, Corrected

- `canAccessBroadDashboards(role)` exists in `lib/dashboardAuth/roles.ts` but returns `true` only for `admin_ceo` and is not called anywhere in production code — it was defined ahead of use. Its own test docstring says "Phase 1"; this plan widens it to include `manager_ops` per this release's approved access model, and puts it to real use for the first time.
- Every one of these pages calls `requireDashboardSession()` (session presence only, verified by direct grep) with **no role check**: `app/dashboard/page.tsx`, `app/(operations)/overview/page.tsx`, `app/(operations)/live-monitor/email-arrival/page.tsx`, `app/(operations)/clients/page.tsx`, `app/(operations)/clients/[clientKey]/page.tsx`, `app/(operations)/operations/page.tsx`, `app/(operations)/operations/interviews/page.tsx`, `app/(operations)/operations/interviews/[id]/page.tsx`, `app/(operations)/review-queue/page.tsx`, `app/(operations)/applications/page.tsx`, `app/(operations)/applications/[applicationId]/page.tsx`, `app/(operations)/mailboxes/page.tsx`, `app/(operations)/ca-portfolio/page.tsx`. The `(operations)/layout.tsx` server component also only checks session presence.
- `app/access-pending/page.tsx` correctly requires only a session — this is intentional per the constraints above and needs no role check.
- Six API routes have **zero** authentication: `app/api/classify/test/route.ts`, `app/api/zoho/emails/classify/test/route.ts`, `app/api/zoho/emails/sync/test/route.ts`, `app/api/zoho/emails/test/route.ts`, `app/api/zoho/emails/test/[messageId]/route.ts`, `app/api/zoho/workflow/test/route.ts`. Confirmed via `CHECKPOINT.md` these are documented, actively-used manual admin tools (sync/classify/inspect), not dead code — so the fix is to add `admin_ceo`-only authorization, not delete them. `app/api/zoho/workflow/cron/route.ts` already correctly requires `CRON_SECRET` (a machine secret) and is untouched by this plan. `app/api/zoho/login/route.ts` already checks `isAdminCeo` for its recovery-mode branch and is untouched. `app/api/zoho/callback/route.ts` is an OAuth redirect target that must remain reachable without a session (that's inherent to the OAuth flow) and is untouched.
- `app/dashboard/page.tsx` contains a second, stale authorization system: it checks `process.env.DASHBOARD_SECRET` itself and renders a "Configuration Error" card if unset — a leftover from the Basic-Auth era that duplicates and confuses the actual (session + role) authorization this plan establishes. It also directly queries and renders raw `zoho_email_metadata` rows (sender, subject, mailbox) to any authenticated user, making it exactly the kind of broad-operations page that needs the new role guard too.
- `middleware.ts` is currently a no-op (`return NextResponse.next()` unconditionally, empty matcher) left over from the prior branch's Basic Auth removal. It performs no security function and produces a lint warning on its unused parameter.
- `lib/dashboardAuth/routeGuardCoverage.test.ts` already inventories every page that must call `requireDashboardSession()`, but only checks for that string — it does not verify role gating at all, so it would not have caught this gap.

## File Structure

- Modify: `lib/dashboardAuth/roles.ts` — widen `canAccessBroadDashboards` to include `manager_ops`.
- Modify: `lib/dashboardAuth/roles.test.ts` — update/extend its test.
- Create: `lib/dashboardAuth/requireOperationsAccess.ts` — server-component guard: valid session + `canAccessBroadDashboards`, else redirect to `/access-pending`.
- Create: `lib/dashboardAuth/requireOperationsAccess.test.ts`
- Create: `lib/dashboardAuth/apiAuth.ts` — route-handler guard: valid session + allowed roles, else `403 NextResponse`.
- Create: `lib/dashboardAuth/apiAuth.test.ts`
- Modify: `app/(operations)/layout.tsx` — use `requireOperationsAccess()` instead of `requireDashboardSession()`.
- Modify (role guard swap, each a one-line change): `app/(operations)/overview/page.tsx`, `app/(operations)/live-monitor/email-arrival/page.tsx`, `app/(operations)/clients/page.tsx`, `app/(operations)/clients/[clientKey]/page.tsx`, `app/(operations)/operations/page.tsx`, `app/(operations)/operations/interviews/page.tsx`, `app/(operations)/operations/interviews/[id]/page.tsx`, `app/(operations)/review-queue/page.tsx`, `app/(operations)/applications/page.tsx`, `app/(operations)/mailboxes/page.tsx`, `app/(operations)/ca-portfolio/page.tsx`, `app/dashboard/page.tsx`.
- Modify: `components/operations/operations-shell-client.tsx` — only render the broad nav items for `admin_ceo`/`manager_ops`.
- Modify: `components/operations/operations-shell-client.test.tsx`
- Modify (auth guard added, each a small change): `app/api/classify/test/route.ts`, `app/api/zoho/emails/classify/test/route.ts`, `app/api/zoho/emails/sync/test/route.ts`, `app/api/zoho/emails/test/route.ts`, `app/api/zoho/emails/test/[messageId]/route.ts`, `app/api/zoho/workflow/test/route.ts`, and each route's test file.
- Modify: `app/dashboard/page.tsx` — remove stale `DASHBOARD_SECRET` check/copy.
- Delete: `middleware.ts`.
- Delete: `middleware.test.ts` (tests only the no-op behavior removed in this plan).
- Modify: `vitest.config.ts` — remove the `middleware.test.ts` include entry added for the deleted file.
- Modify: `lib/dashboardAuth/routeGuardCoverage.test.ts` — strengthen to assert role gating, not just session presence.

---

### Task 1: Extend the Role Check and Add the Server-Component Operations Guard

**Files:**
- Modify: `lib/dashboardAuth/roles.ts`
- Modify: `lib/dashboardAuth/roles.test.ts`
- Create: `lib/dashboardAuth/requireOperationsAccess.ts`
- Create: `lib/dashboardAuth/requireOperationsAccess.test.ts`

**Interfaces:**
- Consumes: `requireDashboardSession()` from `lib/dashboardAuth/requireDashboardSession.ts` (existing, unchanged) → `Promise<DashboardSession>`, where `DashboardSession.user.role` is `DashboardRole`.
- Produces:

```typescript
export function canAccessBroadDashboards(role: DashboardRole): boolean; // widened
export async function requireOperationsAccess(): Promise<DashboardSession>;
```

- [ ] **Step 1: Write the failing tests**

Update `lib/dashboardAuth/roles.test.ts` — change the existing assertions for `canAccessBroadDashboards`:

```typescript
it("allows admin_ceo and manager_ops, denies ca", async () => {
  const { canAccessBroadDashboards } = await import("./roles");

  expect(canAccessBroadDashboards("admin_ceo")).toBe(true);
  expect(canAccessBroadDashboards("manager_ops")).toBe(true);
  expect(canAccessBroadDashboards("ca")).toBe(false);
});
```

(This replaces the prior test's expectation that `manager_ops` was denied — delete the old assertion in the same `it` block rather than leaving both.)

Create `lib/dashboardAuth/requireOperationsAccess.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireDashboardSession = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/dashboardAuth/requireDashboardSession", () => ({ requireDashboardSession }));
vi.mock("next/navigation", () => ({ redirect }));

function session(role: "admin_ceo" | "manager_ops" | "ca") {
  return {
    id: "session-1",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 1000).toISOString(),
    revokedAt: null,
    user: { id: "user-1", email: "user@applywizz.ai", role, status: "active" as const, totpEnabled: true },
  };
}

describe("requireOperationsAccess", () => {
  it("returns the session for admin_ceo", async () => {
    requireDashboardSession.mockResolvedValue(session("admin_ceo"));
    const { requireOperationsAccess } = await import("./requireOperationsAccess");
    await expect(requireOperationsAccess()).resolves.toMatchObject({ user: { role: "admin_ceo" } });
  });

  it("returns the session for manager_ops", async () => {
    requireDashboardSession.mockResolvedValue(session("manager_ops"));
    const { requireOperationsAccess } = await import("./requireOperationsAccess");
    await expect(requireOperationsAccess()).resolves.toMatchObject({ user: { role: "manager_ops" } });
  });

  it("redirects ca to /access-pending without ever returning the session", async () => {
    requireDashboardSession.mockResolvedValue(session("ca"));
    const { requireOperationsAccess } = await import("./requireOperationsAccess");
    await expect(requireOperationsAccess()).rejects.toThrow("REDIRECT:/access-pending");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npx vitest run lib/dashboardAuth/roles.test.ts lib/dashboardAuth/requireOperationsAccess.test.ts`
Expected: `roles.test.ts` FAILs on the `manager_ops` assertion (currently `false`); `requireOperationsAccess.test.ts` FAILs with `Cannot find module './requireOperationsAccess'`.

- [ ] **Step 3: Implement**

In `lib/dashboardAuth/roles.ts`, change:

```typescript
export function canAccessBroadDashboards(role: DashboardRole): boolean {
  return isAdminCeo(role);
}
```

to:

```typescript
export function canAccessBroadDashboards(role: DashboardRole): boolean {
  return role === "admin_ceo" || role === "manager_ops";
}
```

Create `lib/dashboardAuth/requireOperationsAccess.ts`:

```typescript
import "server-only";

import { redirect } from "next/navigation";

import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
import { canAccessBroadDashboards } from "@/lib/dashboardAuth/roles";
import type { DashboardSession } from "@/lib/dashboardAuth/sessionStore";

/**
 * Server-component guard for broad operations pages: requires a valid
 * session AND admin_ceo/manager_ops. A ca session is redirected to
 * /access-pending before any operational data is read or rendered.
 */
export async function requireOperationsAccess(): Promise<DashboardSession> {
  const session = await requireDashboardSession();

  if (!canAccessBroadDashboards(session.user.role)) {
    redirect("/access-pending");
  }

  return session;
}
```

- [ ] **Step 4: Run focused verification**

```bash
npx vitest run lib/dashboardAuth/roles.test.ts lib/dashboardAuth/requireOperationsAccess.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run regression checks**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboardAuth/roles.ts lib/dashboardAuth/roles.test.ts lib/dashboardAuth/requireOperationsAccess.ts lib/dashboardAuth/requireOperationsAccess.test.ts
git commit -m "fix: add server-side role guard for broad operations access"
```

---

### Task 2: Apply the Role Guard to Every Broad Operations Page and Layout

**Files:**
- Modify: `app/(operations)/layout.tsx`
- Modify: `app/(operations)/overview/page.tsx`
- Modify: `app/(operations)/live-monitor/email-arrival/page.tsx`
- Modify: `app/(operations)/clients/page.tsx`
- Modify: `app/(operations)/clients/[clientKey]/page.tsx`
- Modify: `app/(operations)/operations/page.tsx`
- Modify: `app/(operations)/operations/interviews/page.tsx`
- Modify: `app/(operations)/operations/interviews/[id]/page.tsx`
- Modify: `app/(operations)/review-queue/page.tsx`
- Modify: `app/(operations)/applications/page.tsx`
- Modify: `app/(operations)/applications/[applicationId]/page.tsx`
- Modify: `app/(operations)/mailboxes/page.tsx`
- Modify: `app/(operations)/ca-portfolio/page.tsx`
- Modify: `app/dashboard/page.tsx` (role guard only in this task; the stale `DASHBOARD_SECRET` removal is Task 5)
- Modify: `lib/dashboardAuth/routeGuardCoverage.test.ts`

**Interfaces:**
- Consumes: `requireOperationsAccess()` from Task 1.

- [ ] **Step 1: Write the failing test**

Replace `lib/dashboardAuth/routeGuardCoverage.test.ts`'s `guardedPages` check with one that asserts role gating specifically for the broad-operations subset (everything except `dashboard` itself, which gets the same guard, and `access pending`, which intentionally does not):

```typescript
const broadOperationsPages = [
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
  ["dashboard", "app/dashboard/page.tsx"],
] as const;

describe("broad operations pages require role-gated access, not just a session", () => {
  it.each(broadOperationsPages)("%s page calls requireOperationsAccess, not the bare session guard", (_label, filePath) => {
    const source = read(filePath);

    expect(source).toContain("@/lib/dashboardAuth/requireOperationsAccess");
    expect(source).toContain("requireOperationsAccess()");
    expect(source).not.toContain("requireDashboardSession()");
  });

  it("the shared operations layout also calls requireOperationsAccess", () => {
    const source = read("app/(operations)/layout.tsx");
    expect(source).toContain("@/lib/dashboardAuth/requireOperationsAccess");
    expect(source).toContain("requireOperationsAccess()");
  });

  it("access-pending intentionally keeps the bare session guard, not the role guard", () => {
    const source = read("app/access-pending/page.tsx");
    expect(source).toContain("requireDashboardSession()");
    expect(source).not.toContain("requireOperationsAccess");
  });
});
```

Keep the existing `guardedPages`/`clientWrapperPages` describe blocks in the same file as-is — they still correctly assert every page has *a* session guard; this new block additionally requires the *role* guard for the broad-operations subset.

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run lib/dashboardAuth/routeGuardCoverage.test.ts`
Expected: FAIL — every listed page still imports/calls `requireDashboardSession`, not `requireOperationsAccess`.

- [ ] **Step 3: Swap the guard in every listed page**

In each of the 14 files above (excluding `lib/dashboardAuth/routeGuardCoverage.test.ts`, which is handled separately in Step 1), change the import:

```typescript
import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
```

to:

```typescript
import { requireOperationsAccess } from "@/lib/dashboardAuth/requireOperationsAccess";
```

and change the call site:

```typescript
await requireDashboardSession();
```

to:

```typescript
await requireOperationsAccess();
```

If a page already captures the session's return value into a variable (check each file — most currently discard it), keep that assignment, just renaming the call.

In `app/(operations)/layout.tsx`, make the same swap — it currently reads:

```typescript
import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
...
const session = await requireDashboardSession();
```

Change to:

```typescript
import { requireOperationsAccess } from "@/lib/dashboardAuth/requireOperationsAccess";
...
const session = await requireOperationsAccess();
```

Do not change `app/access-pending/page.tsx` — it must keep `requireDashboardSession()` per the constraints (any valid session may reach it, including `ca`).

- [ ] **Step 4: Run focused verification**

```bash
npx vitest run lib/dashboardAuth/routeGuardCoverage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run regression checks**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS. The full suite run also re-exercises `app/(operations)/*` and `app/dashboard` page tests that mock `requireDashboardSession` — if any such test now fails because it no longer imports what the page imports, update that test's mock target from `@/lib/dashboardAuth/requireDashboardSession` to `@/lib/dashboardAuth/requireOperationsAccess` (same mocked return shape, a `DashboardSession`).

- [ ] **Step 6: Commit**

```bash
git add "app/(operations)" app/dashboard/page.tsx lib/dashboardAuth/routeGuardCoverage.test.ts
git commit -m "fix: enforce role access across operations routes"
```

---

### Task 3: Make the Operations Shell Role-Safe

**Files:**
- Modify: `components/operations/operations-shell-client.tsx`
- Modify: `components/operations/operations-shell-client.test.tsx`

**Interfaces:**
- No new exports. `OperationsShellClient`'s existing `userRole` prop (already passed from `app/(operations)/layout.tsx` since the prior branch) is used to conditionally render nav items. Since Task 2 already makes the layout redirect a `ca` session away via `requireOperationsAccess()` before this component ever renders, this task is defense-in-depth only, per the constraint against relying solely on client-side authorization — it must never be the only thing standing between a `ca` session and this nav.

- [ ] **Step 1: Write the failing test**

Add to `components/operations/operations-shell-client.test.tsx`:

```typescript
it("renders full operations navigation for admin_ceo and manager_ops but not for ca", async () => {
  const { OperationsShellClient } = await import("./operations-shell-client");
  const { renderToStaticMarkup } = await import("react-dom/server");

  const admin = renderToStaticMarkup(
    <OperationsShellClient userName="Ramakrishna" userRole="admin_ceo">
      <div>content</div>
    </OperationsShellClient>,
  );
  expect(admin).toContain("Live Monitor");
  expect(admin).toContain("Review Queue");

  const ca = renderToStaticMarkup(
    <OperationsShellClient userName="Navya" userRole="ca">
      <div>content</div>
    </OperationsShellClient>,
  );
  expect(ca).not.toContain("Live Monitor");
  expect(ca).not.toContain("Review Queue");
  expect(ca).not.toContain("Clients");
});
```

(Follow this file's existing `renderToStaticMarkup`-based pattern from the prior branch — do not introduce `@testing-library/react`, which is not installed in this repo.)

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run components/operations/operations-shell-client.test.tsx`
Expected: FAIL — the nav currently renders unconditionally for every role.

- [ ] **Step 3: Gate the nav by role**

In `components/operations/operations-shell-client.tsx`, add a pure helper near `roleLabel`/`initials`:

```typescript
function canSeeBroadNav(role: "admin_ceo" | "manager_ops" | "ca"): boolean {
  return role === "admin_ceo" || role === "manager_ops";
}
```

Wrap the existing `<nav className="sidebar-nav">...</nav>` block's contents (the five `NavLink`s: Overview, Live Monitor, Clients, Operations, Review Queue) with:

```tsx
<nav className="sidebar-nav">
  {canSeeBroadNav(userRole) ? (
    <>
      <NavLink href="/overview" icon={<IconOverview size={20} />} label="Overview" />
      <NavLink href="/live-monitor/email-arrival" icon={<IconMail size={20} />} label="Live Monitor" />
      <NavLink href="/clients" icon={<IconClients size={20} />} label="Clients" />
      <NavLink href="/operations" icon={<IconMailboxes size={20} />} label="Operations" />
      <NavLink href="/review-queue" icon={<IconReviewQueue size={20} />} label="Review Queue" />
    </>
  ) : (
    <NavLink href="/access-pending" icon={<IconOverview size={20} />} label="Access Pending" />
  )}
</nav>
```

Apply the identical change to the mobile `<nav className="drawer-nav">` block (the same five links, duplicated for the mobile drawer per the existing pattern in this file).

- [ ] **Step 4: Run focused verification**

```bash
npx vitest run components/operations
```

Expected: PASS.

- [ ] **Step 5: Run regression checks**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/operations/operations-shell-client.tsx components/operations/operations-shell-client.test.tsx
git commit -m "fix: restrict CA operations navigation"
```

---

### Task 4: Protect the Six Unauthenticated Zoho/Classification API Routes

**Files:**
- Create: `lib/dashboardAuth/apiAuth.ts`
- Create: `lib/dashboardAuth/apiAuth.test.ts`
- Modify: `app/api/classify/test/route.ts`
- Modify: `app/api/zoho/emails/classify/test/route.ts`
- Modify: `app/api/zoho/emails/sync/test/route.ts`
- Modify: `app/api/zoho/emails/test/route.ts`
- Modify: `app/api/zoho/emails/test/[messageId]/route.ts`
- Modify: `app/api/zoho/workflow/test/route.ts`
- Modify each of the above routes' existing test files (create one for any route that currently has none)

**Interfaces:**
- Produces:

```typescript
export type RequireApiRoleResult =
  | { ok: true; session: DashboardSession }
  | { ok: false; response: NextResponse };

export async function requireApiRole(
  request: NextRequest,
  allowedRoles: readonly DashboardRole[],
): Promise<RequireApiRoleResult>;
```

- [ ] **Step 1: Write the failing tests for the new helper**

Create `lib/dashboardAuth/apiAuth.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const getDashboardSessionByToken = vi.fn();

vi.mock("@/lib/dashboardAuth/sessionStore", () => ({ getDashboardSessionByToken }));

function requestWithCookie(value?: string): NextRequest {
  const req = new NextRequest("https://email-apply-wizz.test/api/whatever");
  if (value) req.cookies.set("dashboard_session", value);
  return req;
}

function session(role: "admin_ceo" | "manager_ops" | "ca") {
  return {
    ok: true as const,
    session: {
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      revokedAt: null,
      user: { id: "user-1", email: "user@applywizz.ai", role, status: "active" as const, totpEnabled: true },
    },
  };
}

describe("requireApiRole", () => {
  it("returns ok:true and the session for an allowed role", async () => {
    getDashboardSessionByToken.mockResolvedValue(session("admin_ceo"));
    const { requireApiRole } = await import("./apiAuth");
    const result = await requireApiRole(requestWithCookie("raw-token"), ["admin_ceo"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.user.role).toBe("admin_ceo");
  });

  it("returns a 403 response for a role not in the allowlist", async () => {
    getDashboardSessionByToken.mockResolvedValue(session("ca"));
    const { requireApiRole } = await import("./apiAuth");
    const result = await requireApiRole(requestWithCookie("raw-token"), ["admin_ceo"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns a 403 response when there is no session cookie", async () => {
    const { requireApiRole } = await import("./apiAuth");
    const result = await requireApiRole(requestWithCookie(undefined), ["admin_ceo"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("returns a 403 response when the session lookup fails", async () => {
    getDashboardSessionByToken.mockResolvedValue({ ok: false });
    const { requireApiRole } = await import("./apiAuth");
    const result = await requireApiRole(requestWithCookie("raw-token"), ["admin_ceo"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("fails closed when the session lookup throws", async () => {
    getDashboardSessionByToken.mockRejectedValue(new Error("db unavailable"));
    const { requireApiRole } = await import("./apiAuth");
    const result = await requireApiRole(requestWithCookie("raw-token"), ["admin_ceo"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("does not log the raw session token", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getDashboardSessionByToken.mockResolvedValue(session("admin_ceo"));
    const { requireApiRole } = await import("./apiAuth");
    await requireApiRole(requestWithCookie("super-secret-raw-token"), ["admin_ceo"]);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain("super-secret-raw-token");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("super-secret-raw-token");
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npx vitest run lib/dashboardAuth/apiAuth.test.ts`
Expected: FAIL with `Cannot find module './apiAuth'`.

- [ ] **Step 3: Implement the helper**

Create `lib/dashboardAuth/apiAuth.ts`:

```typescript
import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDashboardSessionByToken, type DashboardSession } from "@/lib/dashboardAuth/sessionStore";
import { DASHBOARD_SESSION_COOKIE_NAME } from "@/lib/dashboardAuth/sessionCookie";
import type { DashboardRole } from "@/lib/dashboardAuth/users";

export type RequireApiRoleResult =
  | { ok: true; session: DashboardSession }
  | { ok: false; response: NextResponse };

function forbidden(): NextResponse {
  return NextResponse.json({ ok: false }, { status: 403 });
}

/**
 * Route-handler authorization guard: requires a valid dashboard session
 * whose role is in allowedRoles. Unlike requireDashboardSession()/
 * requireOperationsAccess() (which redirect, for Server Components), this
 * returns a JSON 403 response for Route Handlers to return directly.
 */
export async function requireApiRole(
  request: NextRequest,
  allowedRoles: readonly DashboardRole[],
): Promise<RequireApiRoleResult> {
  const rawToken = request.cookies.get(DASHBOARD_SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return { ok: false, response: forbidden() };

  try {
    const result = await getDashboardSessionByToken(rawToken);
    if (!result.ok) return { ok: false, response: forbidden() };
    if (!allowedRoles.includes(result.session.user.role)) return { ok: false, response: forbidden() };
    return { ok: true, session: result.session };
  } catch {
    return { ok: false, response: forbidden() };
  }
}
```

- [ ] **Step 4: Run focused verification**

```bash
npx vitest run lib/dashboardAuth/apiAuth.test.ts
```

Expected: PASS.

- [ ] **Step 5: Apply the guard to each of the six routes**

For `app/api/zoho/emails/classify/test/route.ts`, `app/api/zoho/emails/sync/test/route.ts`, and `app/api/zoho/workflow/test/route.ts` (each currently `export async function POST()` with no parameters), change the signature to accept the request and add the guard as the first line:

```typescript
import { type NextRequest, NextResponse } from "next/server";
import { requireApiRole } from "@/lib/dashboardAuth/apiAuth";
// ...existing imports...

export async function POST(request: NextRequest) {
  const auth = await requireApiRole(request, ["admin_ceo"]);
  if (!auth.ok) return auth.response;

  // ...existing body, unchanged...
}
```

For `app/api/zoho/emails/test/route.ts` (currently `export async function GET()`), same pattern with `GET(request: NextRequest)`.

For `app/api/zoho/emails/test/[messageId]/route.ts`, add the guard as the first line inside the existing `GET` handler (it already accepts a `NextRequest` parameter — check the existing signature and reuse the same `request` binding, do not add a second parameter):

```typescript
const auth = await requireApiRole(request, ["admin_ceo"]);
if (!auth.ok) return auth.response;
```

For `app/api/classify/test/route.ts` (already `export async function POST(request: NextRequest)`), add the same two-line guard as the first statement inside the function body, before its existing body-parsing logic.

Do not modify anything else in any of these six files — do not touch their existing sync/classify/fetch logic, error handling, or response shapes beyond adding the guard.

- [ ] **Step 6: Write and run tests proving denial and no side effects**

For each of the six routes, add (or extend the existing test file with) a test proving an unauthorized caller is denied and the route's real action never runs. Follow this exact shape, adapted per route (shown here for `app/api/zoho/emails/sync/test/route.test.ts`, create this file if it does not exist):

```typescript
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireApiRole = vi.fn();
const syncTrackerMailbox = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboardAuth/apiAuth", () => ({ requireApiRole }));
vi.mock("@/lib/worker-core/syncTrackerMailbox", () => ({ syncTrackerMailbox }));

function makeRequest(): NextRequest {
  return new NextRequest("https://email-apply-wizz.test/api/zoho/emails/sync/test", { method: "POST" });
}

describe("POST /api/zoho/emails/sync/test", () => {
  it("returns 403 and never syncs when the caller is not authorized", async () => {
    requireApiRole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) as never });
    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect(syncTrackerMailbox).not.toHaveBeenCalled();
  });

  it("syncs only when the caller is admin_ceo", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { user: { role: "admin_ceo" } } as never });
    syncTrackerMailbox.mockResolvedValue({ synced: 3 });
    const { POST } = await import("./route");
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(syncTrackerMailbox).toHaveBeenCalledTimes(1);
  });
});
```

Adapt the mocked downstream function name per route (`classifyQueue` for the two classify routes, `createSupabaseServerClient`'s query for the two `emails/test` routes — assert the Supabase client factory or fetch call is not invoked when denied, matching whatever that specific route's real dependency is). Run each new/updated test file individually first:

```bash
npx vitest run app/api/classify/test
npx vitest run app/api/zoho/emails/classify/test
npx vitest run app/api/zoho/emails/sync/test
npx vitest run app/api/zoho/emails/test
npx vitest run app/api/zoho/workflow/test
```

Expected: PASS for each.

- [ ] **Step 7: Run regression checks**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/dashboardAuth/apiAuth.ts lib/dashboardAuth/apiAuth.test.ts app/api/classify/test app/api/zoho/emails/classify/test app/api/zoho/emails/sync/test app/api/zoho/emails/test app/api/zoho/workflow/test
git commit -m "fix: protect operational and test APIs"
```

---

### Task 5: Remove the Stale DASHBOARD_SECRET Flow

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify or create: `app/dashboard/page.test.tsx`

**Interfaces:**
- No new exports. This task removes dead code from a file Task 2 already updated to call `requireOperationsAccess()`.

- [ ] **Step 1: Write the failing test**

Create/extend `app/dashboard/page.test.tsx`:

```typescript
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
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run app/dashboard/page.test.tsx`
Expected: FAIL — `process.env.DASHBOARD_SECRET` and the "Configuration Error" card are both still present.

- [ ] **Step 3: Remove the stale block**

In `app/dashboard/page.tsx`, delete the entire block from:

```typescript
  const expectedSecret = process.env.DASHBOARD_SECRET;


  // Fail closed: require DASHBOARD_SECRET to be configured on the server
  if (!expectedSecret) {
```

through its matching closing `}` (the whole `if (!expectedSecret) { return (...); }` block, including its inline `<style>` block) — leave everything after it (the `interface EmailRecord`, the Supabase query, and the rest of the page) unchanged. The page already calls `requireOperationsAccess()` from Task 2, which is now the sole authorization mechanism for this page.

- [ ] **Step 4: Run focused verification**

```bash
npx vitest run app/dashboard
```

Expected: PASS.

- [ ] **Step 5: Run regression checks**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/page.tsx app/dashboard/page.test.tsx
git commit -m "chore: remove stale dashboard secret flow"
```

---

### Task 6: Remove the No-Op Middleware

**Files:**
- Delete: `middleware.ts`
- Delete: `middleware.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:** None — pure deletion.

- [ ] **Step 1: Confirm it is genuinely a no-op before deleting**

```bash
cat middleware.ts
```

Confirm the function body is exactly `return NextResponse.next();` with no conditional logic, and `config.matcher` is `[]`. If either differs from this, STOP and report — do not delete a middleware that does something.

- [ ] **Step 2: Delete the files**

```bash
git rm middleware.ts middleware.test.ts
```

- [ ] **Step 3: Remove the now-unneeded vitest include entry**

In `vitest.config.ts`, remove the `"middleware.test.ts"` entry that was added to the test-include list specifically for the file just deleted (added in the prior branch's Task 8 — check the current include array and remove only that one literal string, leave every other entry unchanged).

- [ ] **Step 4: Run regression checks**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS, and the lint warning about `middleware.ts`'s unused `_request` parameter is gone since the file no longer exists. Confirm via build output that routing is unaffected (no route should change status between this step and the previous commit's build output — compare the `Route (app)` list).

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: remove no-op middleware"
```

---

### Task 7: Final Security Regression Verification

This task adds no new code — it is a verification pass confirming Tasks 1-6 together deliver the required security posture, run from the current branch state (no separate worktree needed).

- [ ] **Step 1: Run the full suite one more time**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
git status --short --branch
```

Expected: all tests pass, lint 0 errors/0 warnings, build passes, diff-check clean, working tree clean after the Task 6 commit.

- [ ] **Step 2: Confirm the security route inventory is real, not vacuous**

Read `lib/dashboardAuth/routeGuardCoverage.test.ts` in full. Confirm it now asserts, for every broad-operations page: (a) a session guard exists (pre-existing `guardedPages` check) and (b) the role guard (`requireOperationsAccess`) exists and the bare `requireDashboardSession()` call is absent (Task 2's new check). Confirm `access-pending` is asserted to keep the bare session guard only. If either assertion set is missing or was weakened during implementation, stop and fix it before proceeding — this is the regression net for every future route added to this app.

- [ ] **Step 3: Confirm no Basic Auth reintroduction and no DASHBOARD_SECRET remnants**

```bash
grep -rn "DASHBOARD_SECRET" --include="*.ts" --include="*.tsx" app lib components | grep -v ".test."
grep -rln "WWW-Authenticate" --include="*.ts" --include="*.tsx" app lib components
```

Expected: the first command returns nothing (no runtime references; `.env.example`'s comment about the variable's Basic-Auth-era purpose is a docs file, not `.ts`/`.tsx`, and is out of scope for this grep). The second command returns nothing (the dead `basicAuthGate.ts` module was already deleted in the prior branch's final-review fix batch).

- [ ] **Step 4: Confirm login flows are unchanged**

```bash
npx vitest run lib/dashboardAuth/authFlow.test.ts lib/dashboardAuth/otpStore.test.ts lib/dashboardAuth/users.test.ts components/dashboard-auth
```

Expected: PASS — this plan does not touch any of the OTP/TOTP login logic; this step confirms that is still true after Tasks 1-6.

- [ ] **Step 5: No commit for this task** — it is verification-only. If any check in Steps 1-4 fails, return to the relevant earlier task and fix it there (with its own commit), then re-run this task's checks.

---

## Self-Review

**Corrected assumptions:**
- `canAccessBroadDashboards` already existed and was already tested but was never called from production code — this plan is the first real consumer of it, not a new invention.
- The six vulnerable API routes are documented, actively-used manual admin tools (per `CHECKPOINT.md`), not orphaned dead code — so they are protected with `admin_ceo`-only authorization (Option B from the review), not deleted (Option A) or given a machine secret (Option C, which is reserved for `/api/zoho/workflow/cron`, already correctly protected and untouched).
- `app/dashboard/page.tsx` needed both a role guard (Task 2, since it renders raw operational email data) and stale-code removal (Task 5) — two separate, separately-committed concerns.

**Spec coverage:**
- Blocker 1 (CA direct-navigation to broad routes) → Tasks 1, 2, 3.
- Blocker 2 (public sensitive APIs) → Task 4.
- Stale `DASHBOARD_SECRET` copy/logic → Task 5.
- No-op middleware cleanup → Task 6.
- CA sidebar defense-in-depth → Task 3.
- Role-gating route inventory test → Task 2 (extends `routeGuardCoverage.test.ts` directly rather than a separate new file, since that is the existing, already-established inventory this repo uses for exactly this purpose).
- Final security regression check → Task 7.
- Login-flow-unchanged confirmation → Task 7, Step 4.

**Scope check:** This plan does not touch CA-level data scoping, manager-to-CA Router mapping, Zoho ingestion logic, Render, Leads sync, or Production. It does not create a new branch, amend existing commits, push, or open a PR.

**Placeholder scan:** No TBD/TODO markers; every step shows complete code.

**Type consistency:** `requireOperationsAccess(): Promise<DashboardSession>` (Task 1) matches its call sites in Task 2's pages/layout. `requireApiRole(request, allowedRoles): Promise<RequireApiRoleResult>` (Task 4) is used identically across all six routes with the same `["admin_ceo"]` allowlist. `canAccessBroadDashboards(role): boolean` (Task 1) is consumed both by `requireOperationsAccess` (Task 1) and the client-side `canSeeBroadNav` helper (Task 3, a separate small function rather than importing a `server-only`-guarded module into a client component).
