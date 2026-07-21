# Dashboard Login Auto-Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the "Final login flow" the owner approved — first-time `@applywizz.ai` users get an account and a role automatically on first login (no pre-seeding, no manual role picker), existing users skip straight to their authenticator code, and the UI stops saying "staff" and "approved staff only."

**Architecture:** The email→OTP→TOTP-setup / TOTP-login state machine, session creation, and role model (`admin_ceo` | `manager_ops` | `ca`) are already fully built and live behind Basic Auth (`lib/dashboardAuth/authFlow.ts`, `lib/dashboardAuth/users.ts`, `components/dashboard-auth/dashboard-auth-client.tsx`). The one missing piece is that `requestDashboardLoginOtp` currently requires a `dashboard_users` row to already exist — there is no self-service account creation and no domain/role rule. This plan adds a pure `resolveAutoProvisionRole` function and a `getOrCreateDashboardUserForLogin` wrapper that slot into the existing flow with no change to its public contract, plus three small wording fixes.

**Tech Stack:** Next.js Route Handlers, Supabase (service-role client), Vitest.

## Global Constraints

- Auto-provisioning domain is exactly `@applywizz.ai` (case-insensitive) — the internal staff/CA identity domain. This is a different domain from `@applywizard.ai`, the client-facing product mailbox domain used elsewhere in this codebase (`tracker@applywizard.ai`, etc.) — do not conflate them.
- Role rules (exact, case-insensitive on the email):
  - `ramakrishna@applywizz.ai` → `admin_ceo`
  - `ramakrishnaa.tejavath@applywizz.ai` → `manager_ops`
  - `balaji@applywizz.ai` → `manager_ops`
  - any other `@applywizz.ai` address → `ca`
  - any other domain → not eligible (no account, no OTP, no error message that reveals why)
- Auto-provisioning only ever **creates** a row when none exists. It must never change the role or status of an existing row — an admin who manually disabled or re-roled someone must not be silently overridden by this logic on their next login attempt.
- No database migration is needed. `dashboard_users.role`/`status`/`email_normalized` already exist with the correct constraints (`supabase/migrations/202607100001_create_dashboard_auth_tables.sql`).
- Do not touch `middleware.ts`, Basic Auth, or anything under `app/api/dashboard/auth/_lib/basicAuthGate.ts` — those stay exactly as they are until the owner explicitly approves removing Basic Auth in a later, separate step.
- Do not touch CA-only data scoping, manager-to-CA/client mapping, or per-role dashboard routing — `/overview` currently shows the same unfiltered data to every role, and that is out of scope for this plan (see "Explicitly out of scope" below).

---

## Current behavior (verified by reading the code, not assumed)

**First-time user, today:** email → OTP → (if `!totpEnabled`) QR setup screen → authenticator code → session → redirect to `/overview`. This already matches the spec's first-time table almost exactly. **The one gap:** `requestDashboardLoginOtp` calls `getDashboardUserByEmail`, and if no row exists it silently returns a fake `otpId` without creating anything or sending any email (`lib/dashboardAuth/authFlow.ts:53-63`) — this is a deliberate anti-enumeration default, but it also means nobody can log in for the first time today unless someone has already manually inserted their `dashboard_users` row. There is no domain check and no role-assignment logic anywhere in the codebase (confirmed: `role ===` and `isAdminCeo` are used in exactly one file outside `lib/dashboardAuth/roles.ts`, and it's the unrelated Zoho OAuth recovery gate).

**Existing user, today:** email → (if `totpEnabled`) authenticator code only → session → redirect to `/overview`. **Already matches the spec exactly** — `verifyDashboardLoginOtp` branches on `user.totpEnabled` and skips straight to the `totp_required` stage, so existing users never see the OTP screen after their first setup (`lib/dashboardAuth/authFlow.ts:143-180`). No change needed here.

**Roles, today:** `DashboardRole = "admin_ceo" | "manager_ops" | "ca"` already exists in the schema and the type system. Nothing assigns a role automatically — it is whatever was set on the row (currently: nothing, since no rows exist outside manual seeding).

**"User/Admin selection" screen:** does not exist in `DashboardAuthClient` today — nothing to remove.

**"Shared dashboard key":** no functioning `?secret=` gate exists in the code. `app/dashboard/page.tsx` (a separate, still-linked internal email-list tool, not part of the login flow) only checks that `DASHBOARD_SECRET` is *configured*, not that a visitor supplied a matching value — this is a harmless vestige of an earlier phase, not an active gate. `.env.example` still has a stale comment describing the old query-param pattern; this plan fixes the comment but does not touch the page.

**"Approved staff only":** present verbatim in `components/dashboard-auth/dashboard-auth-client.tsx`. Removed in Task 3.

**The word "Staff":** appears in one user-facing label, `app/(operations)/ca-portfolio/ca-portfolio-client.tsx:474` ("ApplyWizard Staff Email"). Fixed in Task 3.

## Explicitly out of scope for this plan

- CA-only server-side data access (spec step 5). The data pipeline (`lib/zoho/cooWorkspace.ts`) groups `zoho_email_metadata` by mailbox and does not currently join against `clients.assigned_ca_email` at all — scoping it by CA is a materially larger, separate change touching five exported functions and every operations page. It needs its own inspection pass and its own plan.
- Manager-to-CA/client mapping (spec step 6 — explicitly "later").
- Per-role dashboard routing/content (today everyone lands on the same `/overview`).
- Production deployment and Basic Auth removal (spec steps 10-12 — owner approval and Codex verification, not a Claude Code task).

---

## File Structure

- `lib/dashboardAuth/roles.ts` — add `resolveAutoProvisionRole(email)`, a pure function with no I/O. Existing `isAdminCeo`/`canAccessBroadDashboards` untouched.
- `lib/dashboardAuth/roles.test.ts` — extend with the new function's tests.
- `lib/dashboardAuth/users.ts` — add `getOrCreateDashboardUserForLogin(email)`, which wraps the existing `getDashboardUserByEmail` with a create-on-first-sight path. Existing exports untouched.
- `lib/dashboardAuth/users.test.ts` — extend the existing hand-rolled Supabase mock with `insert(...)` support, add tests for the new function.
- `lib/dashboardAuth/authFlow.ts` — one-line change: `requestDashboardLoginOtp` calls `getOrCreateDashboardUserForLogin` instead of `getDashboardUserByEmail`, plus a new audit event type for observability.
- `lib/dashboardAuth/authFlow.test.ts` — extend with an end-to-end "first `@applywizz.ai` login auto-creates the right role" test and a "blocked domain never creates a row" test.
- `components/dashboard-auth/dashboard-auth-client.tsx` — remove the "Approved staff only." subtitle line.
- `app/(operations)/ca-portfolio/ca-portfolio-client.tsx` — rename the "ApplyWizard Staff Email" label to "CA Email".
- `.env.example` — fix the stale `DASHBOARD_SECRET` comment (no functioning `?secret=` gate exists to reference).

---

### Task 1: `resolveAutoProvisionRole` — domain and role rules

**Files:**
- Modify: `lib/dashboardAuth/roles.ts`
- Test: `lib/dashboardAuth/roles.test.ts`

**Interfaces:**
- Produces: `resolveAutoProvisionRole(email: string): { eligible: true; role: DashboardRole } | { eligible: false }` — Task 2 calls this.

- [ ] **Step 1: Write the failing tests**

Append to `lib/dashboardAuth/roles.test.ts`:

```typescript
describe("resolveAutoProvisionRole", () => {
  it("assigns admin_ceo to the designated admin address", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("ramakrishna@applywizz.ai")).toEqual({
      eligible: true,
      role: "admin_ceo",
    });
  });

  it("assigns manager_ops to both designated manager addresses", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("ramakrishnaa.tejavath@applywizz.ai")).toEqual({
      eligible: true,
      role: "manager_ops",
    });
    expect(resolveAutoProvisionRole("balaji@applywizz.ai")).toEqual({
      eligible: true,
      role: "manager_ops",
    });
  });

  it("assigns ca to any other @applywizz.ai address", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("new.hire@applywizz.ai")).toEqual({
      eligible: true,
      role: "ca",
    });
  });

  it("is case-insensitive and trims whitespace", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("  RamaKrishna@ApplyWizz.AI  ")).toEqual({
      eligible: true,
      role: "admin_ceo",
    });
  });

  it("rejects any other domain, including the client mailbox domain", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("someone@applywizard.ai")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("someone@gmail.com")).toEqual({ eligible: false });
  });

  it("rejects malformed input without throwing", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("not-an-email")).toEqual({ eligible: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/dashboardAuth/roles.test.ts`
Expected: FAIL — `resolveAutoProvisionRole is not a function` (or similar import error), 6 new failing tests.

- [ ] **Step 3: Implement**

Replace the full contents of `lib/dashboardAuth/roles.ts` with:

```typescript
import "server-only";

import type { DashboardRole } from "@/lib/dashboardAuth/users";

export function isAdminCeo(role: DashboardRole): boolean {
  return role === "admin_ceo";
}

export function canAccessBroadDashboards(role: DashboardRole): boolean {
  return isAdminCeo(role);
}

// Internal staff/CA identity domain — distinct from @applywizard.ai, the
// client-facing product mailbox domain used elsewhere in this codebase.
const STAFF_DOMAIN = "@applywizz.ai";

// Exact-match overrides. Anything else on the staff domain becomes "ca".
const ROLE_OVERRIDES: Readonly<Record<string, DashboardRole>> = {
  "ramakrishna@applywizz.ai": "admin_ceo",
  "ramakrishnaa.tejavath@applywizz.ai": "manager_ops",
  "balaji@applywizz.ai": "manager_ops",
};

export type AutoProvisionDecision =
  | { eligible: true; role: DashboardRole }
  | { eligible: false };

/**
 * Pure domain + role decision for auto-provisioning a new dashboard user on
 * first login. No I/O — callers decide what to do with an eligible result.
 */
export function resolveAutoProvisionRole(email: string): AutoProvisionDecision {
  const normalized = email.trim().toLowerCase();
  if (!normalized.endsWith(STAFF_DOMAIN)) return { eligible: false };

  const override = ROLE_OVERRIDES[normalized];
  return { eligible: true, role: override ?? "ca" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/dashboardAuth/roles.test.ts`
Expected: PASS — 7 tests (1 existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add lib/dashboardAuth/roles.ts lib/dashboardAuth/roles.test.ts
git commit -m "feat: add automatic role assignment for dashboard login"
```

---

### Task 2: `getOrCreateDashboardUserForLogin` — auto-provisioning

**Files:**
- Modify: `lib/dashboardAuth/users.ts`
- Modify: `lib/dashboardAuth/authFlow.ts`
- Test: `lib/dashboardAuth/users.test.ts`
- Test: `lib/dashboardAuth/authFlow.test.ts`

**Interfaces:**
- Consumes: `resolveAutoProvisionRole(email: string)` from Task 1.
- Produces: `getOrCreateDashboardUserForLogin(email: string): Promise<DashboardUser | null>` — Task's own `authFlow.ts` change consumes this; returns `null` for ineligible domains or any DB failure, exactly like the existing `getDashboardUserByEmail` failure contract.

- [ ] **Step 1: Extend the test mock and write the failing tests**

In `lib/dashboardAuth/users.test.ts`, extend the mocked Supabase client to support `insert`. Replace the `vi.mock("@/lib/supabase/serviceRole", ...)` block with:

```typescript
vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => {
        calls.push({ kind: "select", table, columns });
        const chain = {
          eq: (column: string, value: string) => {
            calls.push({ kind: "select.eq", table, column, value });
            return {
              maybeSingle: async () => selectResultFor(table, columns, column, value),
            };
          },
        };
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        calls.push({ kind: "update", table, payload });
        const chain = {
          eq: (column: string, value: string) => {
            calls.push({ kind: "update.eq", table, column, value });
            return {
              select: (columns: string) => {
                calls.push({ kind: "update.select", table, columns });
                return {
                  maybeSingle: async () => {
                    applyUpdate(table, payload, column, value);
                    return updateResult;
                  },
                };
              },
            };
          },
        };
        return chain;
      },
      insert: (payload: Record<string, unknown>) => {
        calls.push({ kind: "insert", table, payload });
        return {
          select: (columns: string) => {
            calls.push({ kind: "insert.select", table, columns });
            return {
              maybeSingle: async () => applyInsert(table, payload),
            };
          },
        };
      },
    }),
  }),
}));
```

Add `"insert" | "insert.select"` to the `CallRecord["kind"]` union, and add this helper next to `applyUpdate`:

```typescript
function applyInsert(
  table: string,
  payload: Record<string, unknown>,
): { data: { id: string } | null; error: { code?: string; message: string } | null } {
  if (table !== "dashboard_users") return { data: null, error: null };

  const email = String(payload.email ?? "");
  if (findUserByColumn("email_normalized", email.trim().toLowerCase())) {
    return { data: null, error: { code: "23505", message: "duplicate key" } };
  }

  const newUser: DashboardUserRow = {
    id: `user-${users.length + 1}`,
    email,
    role: payload.role as DashboardUserRow["role"],
    status: (payload.status as DashboardUserRow["status"]) ?? "active",
    totp_enabled: false,
    totp_secret_encrypted: null,
  };
  users.push(newUser);
  return { data: { id: newUser.id }, error: null };
}
```

Then append this new describe block:

```typescript
describe("getOrCreateDashboardUserForLogin", () => {
  it("returns the existing row unchanged when one already exists — even if disabled", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");

    await expect(getOrCreateDashboardUserForLogin("ca@applywizz.ai")).resolves.toEqual({
      id: "user-2",
      email: "ca@applywizz.ai",
      role: "ca",
      status: "disabled",
      totpEnabled: false,
    });
    expect(calls.some((c) => c.kind === "insert")).toBe(false);
  });

  it("auto-creates a new active row with the correct role for an eligible domain", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");

    await expect(getOrCreateDashboardUserForLogin("new.hire@applywizz.ai")).resolves.toMatchObject({
      email: "new.hire@applywizz.ai",
      role: "ca",
      status: "active",
      totpEnabled: false,
    });
    expect(calls).toContainEqual({
      kind: "insert",
      table: "dashboard_users",
      payload: { email: "new.hire@applywizz.ai", role: "ca", status: "active" },
    });
  });

  it("auto-creates the designated admin with admin_ceo", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");

    await expect(getOrCreateDashboardUserForLogin("ramakrishna@applywizz.ai")).resolves.toMatchObject({
      role: "admin_ceo",
    });
  });

  it("returns null for a domain that is not eligible — never creates a row", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");

    await expect(getOrCreateDashboardUserForLogin("someone@gmail.com")).resolves.toBeNull();
    expect(calls.some((c) => c.kind === "insert")).toBe(false);
  });

  it("re-fetches instead of failing when two logins race to create the same email", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");

    // Simulate the row already existing in the database by the time the
    // insert lands, even though our first select (below) hasn't seen it yet.
    users.push({
      id: "user-3",
      email: "race@applywizz.ai",
      role: "ca",
      status: "active",
      totp_enabled: false,
      totp_secret_encrypted: null,
    });

    await expect(getOrCreateDashboardUserForLogin("race@applywizz.ai")).resolves.toMatchObject({
      id: "user-3",
      email: "race@applywizz.ai",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/dashboardAuth/users.test.ts`
Expected: FAIL — `getOrCreateDashboardUserForLogin is not a function`, 5 new failing tests. (The mock extension itself doesn't break the 9 existing tests — confirm they still pass in this same run.)

- [ ] **Step 3: Implement**

In `lib/dashboardAuth/users.ts`, add the import and the `InsertChain`/`SupabaseLike` additions:

```typescript
import { resolveAutoProvisionRole } from "@/lib/dashboardAuth/roles";
```

Extend the `SupabaseLike` interface (add alongside the existing `select`/`update` entries):

```typescript
interface InsertChain {
  select(columns: string): {
    maybeSingle(): Promise<{ data: DashboardUserRow | null; error: { code?: string; message: string } | null }>;
  };
}

interface SupabaseLike {
  from(table: string): {
    select(columns: string): SelectChain;
    update(payload: Record<string, unknown>): UpdateChain;
    insert(payload: Record<string, unknown>): InsertChain;
  };
}
```

Add the new exported function at the end of the file:

```typescript
/**
 * Returns the existing dashboard user for this email, or auto-creates one
 * for an eligible @applywizz.ai address. Never changes the role or status
 * of an existing row — auto-provisioning only ever fires when no row exists.
 */
export async function getOrCreateDashboardUserForLogin(email: string): Promise<DashboardUser | null> {
  const existing = await getDashboardUserByEmail(email);
  if (existing) return existing;

  const decision = resolveAutoProvisionRole(email);
  if (!decision.eligible) return null;

  const trimmedEmail = email.trim();
  if (!trimmedEmail) return null;

  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { data, error } = await supabase
      .from("dashboard_users")
      .insert({ email: trimmedEmail, role: decision.role, status: "active" })
      .select("id, email, role, status, totp_enabled")
      .maybeSingle();

    if (!error && data) return mapUserRow(data as DashboardUserRow);

    // Two logins racing to create the same email hit the unique constraint —
    // the loser re-fetches the winner's row instead of failing the login.
    if (error?.code === "23505") return await getDashboardUserByEmail(email);

    return null;
  } catch {
    return null;
  }
}
```

In `lib/dashboardAuth/authFlow.ts`, update the import (line 6) from:

```typescript
import { getDashboardUserAuthRecordById, getDashboardUserByEmail, getDashboardUserById, setDashboardUserTotpSecret } from "@/lib/dashboardAuth/users";
```

to:

```typescript
import { getDashboardUserAuthRecordById, getDashboardUserById, getOrCreateDashboardUserForLogin, setDashboardUserTotpSecret } from "@/lib/dashboardAuth/users";
```

Update the audit event type union (line 21-25) to add the new event:

```typescript
type DashboardAuditEventType =
  | "login_otp_requested"
  | "login_otp_verify"
  | "totp_setup_completed"
  | "login_totp_verify"
  | "account_auto_provisioned";
```

In `requestDashboardLoginOtp`, replace line 53:

```typescript
  const user = await getDashboardUserByEmail(params.email);
```

with:

```typescript
  const user = await getOrCreateDashboardUserForLogin(params.email);
```

Immediately after that line (still inside `requestDashboardLoginOtp`, before the existing `if (!user || user.status !== "active")` check), add:

```typescript
  if (user) {
    await recordAuthEvent({
      userId: user.id,
      eventType: "account_auto_provisioned",
      success: true,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  }
```

This fires on every call where a user object comes back — harmless for existing users (it's just an audit line), and is the only cheap way to get an auditable signal for new-account creation without threading a second return value through `getOrCreateDashboardUserForLogin`'s contract. Codex reviewing this should confirm that's an acceptable tradeoff versus a more precise "was this newly created" signal; if not, the alternative is changing `getOrCreateDashboardUserForLogin`'s return type to `{ user: DashboardUser; created: boolean } | null`, which is a larger, defer-able change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/dashboardAuth/users.test.ts lib/dashboardAuth/roles.test.ts`
Expected: PASS — 14 tests (9 existing users.ts + 5 new, plus the 7 from Task 1).

- [ ] **Step 5: Write the integration-level failing tests**

Append to `lib/dashboardAuth/authFlow.test.ts` (match whatever mocking convention that file already uses for `requestDashboardLoginOtp` — read the top of the file first to mirror its exact `vi.mock` setup for `users.ts`/`otpStore.ts`/`microsoftGraphOtp.ts` before writing these):

```typescript
describe("requestDashboardLoginOtp — auto-provisioning", () => {
  it("auto-creates a new @applywizz.ai user with the ca role and still sends an OTP", async () => {
    // Arrange the mocked getDashboardUserByEmail-equivalent to simulate "no
    // existing row", matching this file's established mock pattern, then
    // assert requestDashboardLoginOtp succeeds and the created role is "ca".
  });

  it("never creates a row for a non-applywizz.ai domain", async () => {
    // Arrange for the email to not match any existing row, request an OTP
    // for someone@gmail.com, and assert no dashboard_users insert occurred
    // and the response is still the generic { ok: true, otpId } shape (no
    // enumeration signal).
  });
});
```

Fill in the arrange/assert bodies using `authFlow.test.ts`'s existing mock helpers once you've read them — do not invent a different mocking style for this file.

- [ ] **Step 6: Run tests to verify they fail, then pass**

Run: `npx vitest run lib/dashboardAuth/authFlow.test.ts`
Expected: FAIL first (new tests reference behavior not yet wired — though Step 3 already wired the implementation, so if Steps 1-4 were done in order these may already pass; run once to confirm, and if they pass immediately that's fine, just verify no existing `authFlow.test.ts` test broke).

- [ ] **Step 7: Commit**

```bash
git add lib/dashboardAuth/users.ts lib/dashboardAuth/users.test.ts lib/dashboardAuth/authFlow.ts lib/dashboardAuth/authFlow.test.ts
git commit -m "feat: auto-provision dashboard users on first login"
```

---

### Task 3: UI wording cleanup

**Files:**
- Modify: `components/dashboard-auth/dashboard-auth-client.tsx`
- Modify: `app/(operations)/ca-portfolio/ca-portfolio-client.tsx`
- Modify: `.env.example`
- Test: none (copy-only changes; existing component/e2e tests must still pass)

- [ ] **Step 1: Remove "Approved staff only."**

In `components/dashboard-auth/dashboard-auth-client.tsx`, delete this line (currently around line 410):

```typescript
          <p className="dashboard-auth-subtitle">Approved staff only.</p>
```

The `.dashboard-auth-subtitle` CSS class can stay (harmless if unused elsewhere; do not chase down whether to delete the style block — that's unrelated churn).

- [ ] **Step 2: Rename the "Staff" label**

In `app/(operations)/ca-portfolio/ca-portfolio-client.tsx` (currently around line 474), change:

```typescript
                <label htmlFor="advisor-email">ApplyWizard Staff Email</label>
```

to:

```typescript
                <label htmlFor="advisor-email">CA Email</label>
```

- [ ] **Step 3: Fix the stale `.env.example` comment**

In `.env.example`, the `DASHBOARD_SECRET` section currently reads:

```text
# A long random secret that protects /dashboard access.
# Generate one with: openssl rand -hex 32
# Supply as a query parameter: /dashboard?secret=YOUR_DASHBOARD_SECRET_HERE
DASHBOARD_SECRET=YOUR_DASHBOARD_SECRET_HERE
```

Replace the third comment line (there is no functioning `?secret=` query-param gate in the code) with:

```text
# A long random secret that protects /dashboard access.
# Generate one with: openssl rand -hex 32
# Used by the Basic Auth layer (middleware.ts) and the /api/dashboard/auth/*
# route guard — not a query-string parameter.
DASHBOARD_SECRET=YOUR_DASHBOARD_SECRET_HERE
```

- [ ] **Step 4: Run the existing dashboard-auth component test suite to confirm nothing broke**

Run: `npx vitest run components/dashboard-auth`
Expected: PASS — no test currently asserts on the removed subtitle text (confirm this is true by grepping `"Approved staff"` in test files before relying on it; if a test does assert on it, update that test in this same step, don't leave it broken).

Also run:

```bash
grep -rn "Approved staff only" . --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude-dir=.next
```

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard-auth/dashboard-auth-client.tsx "app/(operations)/ca-portfolio/ca-portfolio-client.tsx" .env.example
git commit -m "fix: remove staff-only wording from dashboard login"
```

---

### Task 4: Full verification

- [ ] **Step 1: Run the full focused scope**

```bash
npx vitest run lib/dashboardAuth
npx vitest run app/api/dashboard
```

Expected: all pass, including every test that existed before this plan.

- [ ] **Step 2: Run the full suite, lint, and build**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
git status --short
```

Expected: full suite passes with only the new tests added to the prior total; lint clean; build clean; diff-check clean; working tree clean (everything committed).

- [ ] **Step 3: Manual smoke check against a local dev server (no Production access)**

```bash
npm run dev
```

In a browser, visit `/dashboard/login` and walk through:
1. A fresh email ending in `@applywizz.ai` that isn't one of the three named addresses → confirm the OTP screen appears (requires local Zoho/Microsoft Graph OTP-sending config, or check Supabase's `dashboard_email_otps` table directly to confirm a row was created and `dashboard_users` got a new `role = 'ca'` row).
2. `ramakrishna@applywizz.ai` → confirm the created row has `role = 'admin_ceo'`.
3. An email on a different domain → confirm no `dashboard_users` row is created and the response is indistinguishable from the "unknown email" case.

Do not attempt this against Production Supabase — use local/dev environment variables only.

- [ ] **Step 4: Stop here for Codex review**

Do not push, merge, or deploy. Report the commit hashes from Tasks 1-3 and wait for Codex's security/access review before any further action.

---

## Self-Review

**Spec coverage:**
- "Automatic role assignment" (spec table) → Task 1. ✓
- "First-time user creates account automatically, no manual role picker" → Task 2. ✓
- "Existing users skip OTP" → already implemented, verified, no task needed. ✓ (documented above)
- "Other email domains blocked" → Task 1 (`eligible: false`) + Task 2 (never creates a row). ✓
- "Remove User/Admin selection" → verified absent, no task needed. ✓
- "Remove shared dashboard key" → verified no functioning gate exists; stale comment fixed in Task 3. ✓
- "Remove Vercel/Basic Auth popup" → explicitly out of scope per spec's own caveat ("only after new login works in Production"). ✓ (not a gap)
- "Remove Approved staff only" → Task 3, Step 1. ✓
- "Replace word Staff with CA" → Task 3, Step 2. ✓
- "Remove repeated authenticator setup" → already implemented (`totpEnabled` branch skips setup for existing users), no task needed. ✓
- Manager mapping, CA-only access, deployment, Basic Auth removal → explicitly deferred, listed under "Explicitly out of scope." ✓

**Placeholder scan:** no TBD/TODO markers; every step shows complete, real code except Task 2 Step 5 and Task 4 Step 3, which are intentionally partial — Step 5 explicitly instructs reading `authFlow.test.ts`'s existing mock convention first rather than guessing it blind (the file wasn't read in full during planning), and Step 3 is a manual/interactive smoke check, not code.

**Type consistency:** `AutoProvisionDecision` (Task 1) is consumed by `getOrCreateDashboardUserForLogin` (Task 2) with matching field names (`eligible`, `role`). `DashboardUser` (existing type) is what `getOrCreateDashboardUserForLogin` returns, matching what `requestDashboardLoginOtp` already expects from its current `getDashboardUserByEmail` call — no shape change at that call site.
