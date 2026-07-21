# Dashboard Login Auto-Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the approved dashboard login flow: first-time `@applywizz.ai` users are created automatically with the correct role, returning authenticator users skip email OTP, and the UI stops using "staff" wording.

**Architecture:** Keep the existing dashboard auth routes, session code, OTP storage, TOTP setup/login code, and Basic Auth outer gate. Add one server-side role resolver, one idempotent user auto-provisioning helper, and one server-authoritative login-start branch that sends email OTP only for first-time setup. Do not add role pickers, new auth providers, or data-access filtering in this slice.

**Tech Stack:** Next.js Route Handlers, Supabase service-role client, Vitest.

## Global Constraints

- Auto-provisioning domain is exactly `@applywizz.ai`, case-insensitive after trimming and lowercasing.
- Valid login email syntax for this release is intentionally narrow: exactly one `@`, non-empty local part, no spaces, no `+` aliases, and exact domain `applywizz.ai`.
- `@applywizard.ai` is the product mailbox/client domain and must never be accepted for dashboard staff/CA login.
- Role rules are exact:
  - `ramakrishna@applywizz.ai` -> `admin_ceo`
  - `ramakrishnaa.tejavath@applywizz.ai` -> `manager_ops`
  - `balaji@applywizz.ai` -> `manager_ops`
  - every other valid `@applywizz.ai` address -> `ca`
- Users cannot supply a role from the browser.
- Auto-provisioning only creates a row when no row exists. It must never reactivate a disabled user, overwrite an existing role, reset TOTP, or create duplicates.
- Returning `totp_enabled=true` users must follow `email -> authenticator code -> session`; no email OTP is sent for normal returning login.
- First-time users must follow `email -> email OTP -> authenticator setup -> authenticator verification -> session`.
- A newly auto-created user is `status = "active"` and `totp_enabled = false` until setup completes. If OTP delivery fails, keep that incomplete account for safe retry; do not delete it, duplicate it, enable TOTP, or create a session.
- Email OTP remains available for first-time setup. Lost-authenticator and suspicious-login recovery are separate explicit flows, not implicit normal login behavior.
- Existing roles, status, TOTP secrets, session lifetime, rate limits, and login audit behavior must be preserved unless this plan explicitly changes them.
- No database migration is needed. `dashboard_users.role`, `dashboard_users.status`, and generated `email_normalized` already exist in `supabase/migrations/202607100001_create_dashboard_auth_tables.sql`.
- Do not touch `middleware.ts`, Basic Auth, or `app/api/dashboard/auth/_lib/basicAuthGate.ts`.
- Do not touch CA-only data scoping, manager-to-CA mapping, Zoho OAuth recovery, Leads synchronization, migrations, Production deployment, or Basic Auth removal.
- Auto-provisioned CA users must not be allowed broad operational data access until server-side CA data scoping is implemented and verified.

---

## Current Behavior, Corrected

- First-time users cannot currently self-create. `requestDashboardLoginOtp` calls `getDashboardUserByEmail`; missing rows get a non-deliverable fallback OTP id and no email.
- Returning TOTP users do **not** currently skip email OTP. The current path is `email -> email OTP -> authenticator code -> session`.
- `verifyDashboardLoginOtp` skips repeated QR setup for `totp_enabled=true` users, but only after the email OTP has been verified.
- Roles `admin_ceo`, `manager_ops`, and `ca` already exist.
- There is no User/Admin role picker to remove.
- `DASHBOARD_SECRET` is still Basic Auth related; the stale `.env.example` query-string wording should be corrected only as copy.

## File Structure

- Modify: `lib/dashboardAuth/roles.ts` — add pure role/domain resolver.
- Modify: `lib/dashboardAuth/roles.test.ts` — resolver tests.
- Modify: `lib/dashboardAuth/users.ts` — add idempotent auto-provision helper returning `{ user, created }`.
- Modify: `lib/dashboardAuth/users.test.ts` — auto-provision, inactive, conflict, and no-overwrite tests.
- Modify: `lib/dashboardAuth/otpStore.ts` — add minimal OTP reuse lookup for one in-flight first-login challenge.
- Modify: `lib/dashboardAuth/otpStore.test.ts` — OTP reuse tests.
- Modify: `lib/dashboardAuth/authFlow.ts` — add login-start branching, per-email database-backed login-start lock, idempotent OTP issuance, and precise audit event.
- Modify: `lib/dashboardAuth/authFlow.test.ts` — first-time flow, returning TOTP shortcut, no false audit, no session-before-auth tests.
- Modify: `lib/dashboardAuth/microsoftGraphOtp.ts` — classify explicit send failures vs uncertain network/timeout failures.
- Modify: `lib/dashboardAuth/microsoftGraphOtp.test.ts` — provider failure classification tests.
- Modify: `app/api/dashboard/auth/request-otp/route.ts` — return the new server-authoritative login-start result shape.
- Modify: `app/api/dashboard/auth/request-otp/route.test.tsx` — route response tests.
- Modify: `components/dashboard-auth/dashboard-auth-client.tsx` — route returning users directly to authenticator step and remove subtitle.
- Modify: `app/(operations)/ca-portfolio/ca-portfolio-client.tsx` — rename "Staff" label to "CA".
- Modify: `.env.example` — correct stale `DASHBOARD_SECRET` comment.

---

### Task 1: Add Server-Side Role Resolver

**Files:**
- Modify: `lib/dashboardAuth/roles.ts`
- Modify: `lib/dashboardAuth/roles.test.ts`

**Interfaces:**
- Produces:

```typescript
export type AutoProvisionDecision =
  | { eligible: true; email: string; role: DashboardRole }
  | { eligible: false };

export function resolveAutoProvisionRole(email: string): AutoProvisionDecision;
```

- [ ] **Step 1: Write the failing tests**

Add tests in `lib/dashboardAuth/roles.test.ts`:

```typescript
describe("resolveAutoProvisionRole", () => {
  it("assigns admin_ceo to the designated admin address", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("ramakrishna@applywizz.ai")).toEqual({
      eligible: true,
      email: "ramakrishna@applywizz.ai",
      role: "admin_ceo",
    });
  });

  it("assigns manager_ops to both designated manager addresses", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("ramakrishnaa.tejavath@applywizz.ai")).toMatchObject({ eligible: true, role: "manager_ops" });
    expect(resolveAutoProvisionRole("balaji@applywizz.ai")).toMatchObject({ eligible: true, role: "manager_ops" });
  });

  it("assigns ca to any other valid applywizz address", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("user@applywizz.ai")).toEqual({
      eligible: true,
      email: "user@applywizz.ai",
      role: "ca",
    });
  });

  it("trims and lowercases before matching", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("  USER@APPLYWIZZ.AI  ")).toEqual({
      eligible: true,
      email: "user@applywizz.ai",
      role: "ca",
    });
  });

  it("rejects subdomains, lookalikes, product-mailbox domain, and external domains", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("user+test@applywizz.ai")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("user@sub.applywizz.ai")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("user@applywizz.ai.evil")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("user@applywizard.ai")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("user@gmail.com")).toEqual({ eligible: false });
  });

  it("rejects malformed input without throwing", async () => {
    const { resolveAutoProvisionRole } = await import("./roles");
    expect(resolveAutoProvisionRole("@applywizz.ai")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("user@")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("")).toEqual({ eligible: false });
    expect(resolveAutoProvisionRole("not-an-email")).toEqual({ eligible: false });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run lib/dashboardAuth/roles.test.ts`

Expected: FAIL with `resolveAutoProvisionRole is not a function`.

- [ ] **Step 3: Implement the resolver**

Add to `lib/dashboardAuth/roles.ts` without changing existing exports:

```typescript
const STAFF_DOMAIN = "applywizz.ai";

const ROLE_OVERRIDES: Readonly<Record<string, DashboardRole>> = {
  "ramakrishna@applywizz.ai": "admin_ceo",
  "ramakrishnaa.tejavath@applywizz.ai": "manager_ops",
  "balaji@applywizz.ai": "manager_ops",
};

export type AutoProvisionDecision =
  | { eligible: true; email: string; role: DashboardRole }
  | { eligible: false };

export function resolveAutoProvisionRole(email: string): AutoProvisionDecision {
  const normalized = email.trim().toLowerCase();
  const [localPart, domain, extra] = normalized.split("@");

  if (!localPart || localPart.includes("+") || /\s/u.test(normalized) || !domain || extra !== undefined || domain !== STAFF_DOMAIN) {
    return { eligible: false };
  }

  return {
    eligible: true,
    email: normalized,
    role: ROLE_OVERRIDES[normalized] ?? "ca",
  };
}
```

- [ ] **Step 4: Run focused verification**

Run: `npx vitest run lib/dashboardAuth/roles.test.ts`

Expected: PASS.

- [ ] **Step 5: Run regression checks for this task**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboardAuth/roles.ts lib/dashboardAuth/roles.test.ts
git commit -m "feat: add automatic dashboard role resolution"
```

---

### Task 2: Add Idempotent Dashboard User Auto-Provisioning

**Files:**
- Modify: `lib/dashboardAuth/users.ts`
- Modify: `lib/dashboardAuth/users.test.ts`

**Interfaces:**
- Consumes: `resolveAutoProvisionRole(email)`.
- Produces:

```typescript
export type DashboardUserForLoginResult =
  | { user: DashboardUser; created: boolean }
  | null;

export async function getOrCreateDashboardUserForLogin(email: string): Promise<DashboardUserForLoginResult>;
```

- [ ] **Step 1: Write failing user tests**

Add tests in `lib/dashboardAuth/users.test.ts` for:

```typescript
describe("getOrCreateDashboardUserForLogin", () => {
  it("creates a new active ca user for a valid applywizz email", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");
    await expect(getOrCreateDashboardUserForLogin("New.User@ApplyWizz.AI")).resolves.toMatchObject({
      created: true,
      user: {
        email: "new.user@applywizz.ai",
        role: "ca",
        status: "active",
        totpEnabled: false,
      },
    });
  });

  it("returns existing users unchanged and created=false", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");
    await expect(getOrCreateDashboardUserForLogin("admin@applywizz.ai")).resolves.toMatchObject({
      created: false,
      user: { id: "user-1", role: "admin_ceo", status: "active" },
    });
    expect(noInsertOccurred()).toBe(true);
  });

  it("returns disabled users unchanged so authFlow can block them", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");
    await expect(getOrCreateDashboardUserForLogin("disabled@applywizz.ai")).resolves.toMatchObject({
      created: false,
      user: { status: "disabled" },
    });
  });

  it("returns null and inserts nothing for blocked domains", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");
    await expect(getOrCreateDashboardUserForLogin("user@applywizard.ai")).resolves.toBeNull();
    expect(noInsertOccurred()).toBe(true);
  });

  it("recovers from PostgreSQL 23505 by re-reading the winning row", async () => {
    forceNextDashboardUserInsertToReturn23505ThenExposeRow({
      id: "race-user",
      email: "race@applywizz.ai",
      role: "ca",
      status: "active",
      totp_enabled: false,
    });

    const { getOrCreateDashboardUserForLogin } = await import("./users");
    await expect(getOrCreateDashboardUserForLogin("race@applywizz.ai")).resolves.toMatchObject({
      created: false,
      user: { id: "race-user", email: "race@applywizz.ai" },
    });
  });
});
```

Implement the test helpers in the existing mock, not production code:

```typescript
let nextInsertResult: { data: DashboardUserRow | null; error: { code?: string; message: string } | null } | null = null;
const rowsVisibleAfterNextInsertConflict: DashboardUserRow[] = [];

function noInsertOccurred(): boolean {
  return !calls.some((call) => call.kind === "insert");
}

function forceNextDashboardUserInsertToReturn23505ThenExposeRow(row: DashboardUserRow): void {
  nextInsertResult = { data: null, error: { code: "23505", message: "duplicate key" } };
  rowsVisibleAfterNextInsertConflict.push(row);
}
```

The conflict test must perform an initial select with no row, an insert that returns `23505`, and a second select that returns the winning row.

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run lib/dashboardAuth/users.test.ts`

Expected: FAIL with `getOrCreateDashboardUserForLogin is not a function`.

- [ ] **Step 3: Implement the helper**

In `lib/dashboardAuth/users.ts`, extend the Supabase mockable interface with `insert`, import `resolveAutoProvisionRole`, and add:

```typescript
export type DashboardUserForLoginResult =
  | { user: DashboardUser; created: boolean }
  | null;

export async function getOrCreateDashboardUserForLogin(email: string): Promise<DashboardUserForLoginResult> {
  const existing = await getDashboardUserByEmail(email);
  if (existing) return { user: existing, created: false };

  const decision = resolveAutoProvisionRole(email);
  if (!decision.eligible) return null;

  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { data, error } = await supabase
      .from("dashboard_users")
      .insert({ email: decision.email, role: decision.role, status: "active" })
      .select("id, email, role, status, totp_enabled")
      .maybeSingle();

    if (!error && data) return { user: mapUserRow(data as DashboardUserRow), created: true };

    if (error?.code === "23505") {
      const racedUser = await getDashboardUserByEmail(decision.email);
      return racedUser ? { user: racedUser, created: false } : null;
    }

    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run focused verification**

Run: `npx vitest run lib/dashboardAuth/users.test.ts lib/dashboardAuth/roles.test.ts`

Expected: PASS.

- [ ] **Step 5: Run regression checks for this task**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboardAuth/users.ts lib/dashboardAuth/users.test.ts
git commit -m "feat: auto-provision dashboard users"
```

---

### Task 3: Add Idempotent OTP Issuance

**Files:**
- Modify: `lib/dashboardAuth/otpStore.ts`
- Modify: `lib/dashboardAuth/otpStore.test.ts`

**Interfaces:**
- Produces:

```typescript
export async function getLatestUsableDashboardEmailOtp(userId: string): Promise<{ ok: true; challengeId: string; expiresAt: string } | { ok: false }>;
export async function invalidateDashboardEmailOtp(otpId: string): Promise<{ ok: true } | { ok: false }>;
```

No migration is needed. The existing `dashboard_email_otps` table has `user_id`, `expires_at`, `used_at`, and `attempt_count`; reuse means selecting the newest row where `used_at is null`, `expires_at > now`, and `attempt_count = 0`.

- [ ] **Step 1: Write failing OTP reuse tests**

Add tests in `lib/dashboardAuth/otpStore.test.ts`:

```typescript
describe("getLatestUsableDashboardEmailOtp", () => {
  it("returns the newest unexpired unused zero-attempt OTP for a user", async () => {
    seedOtpRows([
      { id: "old", user_id: "user-1", expires_at: futureIso(2), used_at: null, attempt_count: 0, created_at: pastIso(2) },
      { id: "new", user_id: "user-1", expires_at: futureIso(8), used_at: null, attempt_count: 0, created_at: pastIso(1) },
    ]);

    const { getLatestUsableDashboardEmailOtp } = await import("./otpStore");
    await expect(getLatestUsableDashboardEmailOtp("user-1")).resolves.toEqual({
      ok: true,
      challengeId: "new",
      expiresAt: expect.any(String),
    });
  });

  it("ignores used, expired, attempted, and other-user OTP rows", async () => {
    seedOtpRows([
      { id: "used", user_id: "user-1", expires_at: futureIso(8), used_at: nowIso(), attempt_count: 0 },
      { id: "expired", user_id: "user-1", expires_at: pastIso(1), used_at: null, attempt_count: 0 },
      { id: "attempted", user_id: "user-1", expires_at: futureIso(8), used_at: null, attempt_count: 1 },
      { id: "other", user_id: "user-2", expires_at: futureIso(8), used_at: null, attempt_count: 0 },
    ]);

    const { getLatestUsableDashboardEmailOtp } = await import("./otpStore");
    await expect(getLatestUsableDashboardEmailOtp("user-1")).resolves.toEqual({ ok: false });
  });

  it("invalidates an OTP by marking it used", async () => {
    seedOtpRows([{ id: "otp-1", user_id: "user-1", expires_at: futureIso(8), used_at: null, attempt_count: 0 }]);
    const { invalidateDashboardEmailOtp } = await import("./otpStore");
    await expect(invalidateDashboardEmailOtp("otp-1")).resolves.toEqual({ ok: true });
    expect(getOtpRow("otp-1")?.used_at).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run lib/dashboardAuth/otpStore.test.ts`

Expected: FAIL with `getLatestUsableDashboardEmailOtp is not a function`.

- [ ] **Step 3: Implement the minimal lookup**

In `lib/dashboardAuth/otpStore.ts`, add a select method to the testable Supabase interface if needed, then add:

```typescript
export async function getLatestUsableDashboardEmailOtp(
  userId: string,
): Promise<{ ok: true; challengeId: string; expiresAt: string } | { ok: false }> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { data, error } = await supabase
      .from("dashboard_email_otps")
      .select("id, expires_at")
      .eq("user_id", userId)
      .is("used_at", null)
      .eq("attempt_count", "0")
      .gt("expires_at", nowIso())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return { ok: false };
    return { ok: true, challengeId: data.id, expiresAt: data.expires_at };
  } catch {
    return { ok: false };
  }
}

export async function invalidateDashboardEmailOtp(otpId: string): Promise<{ ok: true } | { ok: false }> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { error } = await supabase
      .from("dashboard_email_otps")
      .update({ used_at: nowIso() })
      .eq("id", otpId)
      .is("used_at", null);
    return error ? { ok: false } : { ok: true };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 4: Run focused and regression checks**

```bash
npx vitest run lib/dashboardAuth/otpStore.test.ts
npx vitest run lib/dashboardAuth
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboardAuth/otpStore.ts lib/dashboardAuth/otpStore.test.ts
git commit -m "feat: reuse active dashboard login OTP challenges"
```

---

### Task 4: Add Server-Authoritative Login Start Flow

**Files:**
- Modify: `lib/dashboardAuth/authFlow.ts`
- Modify: `lib/dashboardAuth/authFlow.test.ts`
- Modify: `app/api/dashboard/auth/request-otp/route.ts`
- Modify: `app/api/dashboard/auth/request-otp/route.test.tsx`
- Modify: `components/dashboard-auth/dashboard-auth-client.tsx`
- Modify: `lib/dashboardAuth/microsoftGraphOtp.ts`
- Modify: `lib/dashboardAuth/microsoftGraphOtp.test.ts`

**Interfaces:**
- Consumes: `getOrCreateDashboardUserForLogin(email)`.
- Consumes: `getLatestUsableDashboardEmailOtp(userId)`.
- Consumes: `invalidateDashboardEmailOtp(otpId)`.
- Produces:

```typescript
export type DashboardLoginStartResult =
  | { ok: true; nextStep: "email_otp"; challengeId: string }
  | { ok: true; nextStep: "totp"; challenge: string };
```

Account-enumeration note: returning `nextStep: "totp"` reveals to someone who already passed Basic Auth that a submitted company email has an active TOTP dashboard account. This is accepted for the first release because the login is internal-only and still requires a valid authenticator code. External/nonexistent/disabled users must still receive the generic email-OTP-shaped response with no email sent.

OTP idempotency design: reuse the existing `cron_locks` table with owner-token release semantics. The lock key must be `dashboard_login_start:${sha256(normalizedEmail)}` so the database stores no raw email address. On `23505`, wait briefly and retry lock acquisition until the first request releases it or the short wait budget expires. Inside the lock, re-check/create the dashboard user, then check `getLatestUsableDashboardEmailOtp(user.id)`. If a usable challenge exists, return it and do not send another email. Otherwise create one OTP and send one email. If the lock cannot be acquired after the wait budget, return a generic `email_otp` response without creating an OTP or sending email. No migration is needed because `cron_locks.lock_key`, `started_at`, and `owner_token` already exist.

- [ ] **Step 1: Write failing authFlow tests**

Add tests in `lib/dashboardAuth/authFlow.test.ts`:

```typescript
describe("startDashboardLogin", () => {
  it("auto-provisions a first-time applywizz user, sends email OTP, and creates no session", async () => {
    const { startDashboardLogin } = await import("./authFlow");
    const result = await startDashboardLogin({ email: "new.ca@applywizz.ai" });

    expect(result).toEqual({ ok: true, nextStep: "email_otp", challengeId: expect.any(String) });
    expect(sentEmails).toHaveLength(1);
    expect(createdOtps).toHaveLength(1);
    expect(sessions).toHaveLength(0);
    expect(audits).toContainEqual(expect.objectContaining({ eventType: "account_auto_provisioned", success: true }));
  });

  it("does not create a false auto-provision audit event for existing users", async () => {
    const { startDashboardLogin } = await import("./authFlow");
    await startDashboardLogin({ email: "admin@applywizz.ai" });
    expect(audits.filter((event) => event.eventType === "account_auto_provisioned")).toHaveLength(0);
  });

  it("serializes concurrent first-login starts so only one OTP and email are issued", async () => {
    const firstLock = deferFirstLoginStartLockRelease();
    const { startDashboardLogin } = await import("./authFlow");
    const starts = Promise.all([
      startDashboardLogin({ email: "race@applywizz.ai" }),
      startDashboardLogin({ email: "race@applywizz.ai" }),
    ]);
    firstLock.release();
    const results = await starts;

    expect(results).toEqual([
      { ok: true, nextStep: "email_otp", challengeId: expect.any(String) },
      { ok: true, nextStep: "email_otp", challengeId: results[0].challengeId },
    ]);
    expect(audits.filter((event) => event.eventType === "account_auto_provisioned")).toHaveLength(1);
    expect(createdOtps).toHaveLength(1);
    expect(sentEmails).toHaveLength(1);
  });

  it("routes returning TOTP users directly to authenticator login with no email OTP", async () => {
    users[0].totpEnabled = true;
    users[0].totpSecretEncrypted = "encrypted-secret";

    const { startDashboardLogin } = await import("./authFlow");
    const result = await startDashboardLogin({ email: "admin@applywizz.ai" });

    expect(result).toEqual({ ok: true, nextStep: "totp", challenge: expect.stringMatching(/^loginchallengev1_/u) });
    expect(sentEmails).toHaveLength(0);
    expect(createdOtps).toHaveLength(0);
    expect(sessions).toHaveLength(0);
  });

  it("blocks inactive users without reactivation, OTP, TOTP challenge, or session", async () => {
    const { startDashboardLogin } = await import("./authFlow");
    const result = await startDashboardLogin({ email: "disabled@applywizz.ai" });

    expect(result).toEqual({ ok: true, nextStep: "email_otp", challengeId: expect.any(String) });
    expect(sentEmails).toHaveLength(0);
    expect(createdOtps).toHaveLength(0);
    expect(sessions).toHaveLength(0);
  });
});
```

Define the concrete race/failure helpers in `authFlow.test.ts`, matching the existing mock style:

```typescript
function deferFirstLoginStartLockRelease(): { release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  deferredLockReleases.push(promise);
  return { release };
}

function failNextOtpInsert(): void {
  nextOtpInsertResult = { ok: false };
}

function failNextOtpEmailSend(): void {
  nextEmailSendResult = { ok: false, reason: "explicit_failure" };
}

function timeoutAfterPotentialProviderAcceptance(): void {
  nextEmailSendResult = { ok: false, reason: "timeout_or_unknown" };
}
```

The mocked Supabase lock operations must simulate:

1. first request inserts `cron_locks` successfully;
2. second request receives `23505` while first holds the lock;
3. first request creates the user, creates one OTP, sends one email, and releases the lock by matching `lock_key + owner_token`;
4. second request then acquires the same hashed lock key, re-reads the existing user, finds the active OTP, sends no email, and releases its own lock.

Keep existing OTP-verification tests: first-time users still go from email OTP to either `totp_setup_required` or `totp_required` depending on `totp_enabled`.
Also keep existing session and TOTP verification tests so session lifetime, TOTP attempt throttling, encrypted secret storage, and login audit behavior remain covered.
Add explicit provider-failure tests:

```typescript
it("does not call email provider when OTP challenge creation fails", async () => {
  failNextOtpInsert();
  const { startDashboardLogin } = await import("./authFlow");
  await expect(startDashboardLogin({ email: "new.ca@applywizz.ai" })).resolves.toEqual({
    ok: true,
    nextStep: "email_otp",
    challengeId: expect.any(String),
  });
  expect(sentEmails).toHaveLength(0);
  expect(sessions).toHaveLength(0);
  expect(audits).toContainEqual(expect.objectContaining({ eventType: "login_otp_requested", success: false }));
});

it("does not create a second user or provisioning audit after explicit email-provider failure", async () => {
  failNextOtpEmailSend();
  const { startDashboardLogin } = await import("./authFlow");
  const first = await startDashboardLogin({ email: "new.ca@applywizz.ai" });
  const second = await startDashboardLogin({ email: "new.ca@applywizz.ai" });
  expect(users.filter((user) => user.email === "new.ca@applywizz.ai")).toHaveLength(1);
  expect(audits.filter((event) => event.eventType === "account_auto_provisioned")).toHaveLength(1);
  expect(invalidatedOtps).toHaveLength(1);
  expect(second.challengeId).not.toBe(first.challengeId);
  expect(sentEmails).toHaveLength(1);
});

it("reuses an active OTP after provider timeout instead of blindly issuing another immediately", async () => {
  timeoutAfterPotentialProviderAcceptance();
  const { startDashboardLogin } = await import("./authFlow");
  const first = await startDashboardLogin({ email: "new.ca@applywizz.ai" });
  const second = await startDashboardLogin({ email: "new.ca@applywizz.ai" });
  expect(second).toEqual(first);
  expect(createdOtps).toHaveLength(1);
});
```

- [ ] **Step 2: Run the failing authFlow test**

Run: `npx vitest run lib/dashboardAuth/authFlow.test.ts`

Expected: FAIL with `startDashboardLogin is not a function`.

- [ ] **Step 3: Implement authFlow branching**

In `lib/dashboardAuth/authFlow.ts`, keep `verifyDashboardLoginOtp`, `completeDashboardTotpSetup`, and `verifyDashboardLoginTotp` intact. Replace normal callers of `requestDashboardLoginOtp` with a new exported `startDashboardLogin`.

Add:

```typescript
export type DashboardLoginStartResult =
  | { ok: true; nextStep: "email_otp"; challengeId: string }
  | { ok: true; nextStep: "totp"; challenge: string };

export async function startDashboardLogin(params: {
  email: string;
  ip?: string;
  userAgent?: string;
}): Promise<DashboardLoginStartResult> {
  const normalizedEmail = normalizeDashboardLoginEmailForLock(params.email);
  const fallbackChallengeId = randomUUID();
  const lock = await acquireDashboardLoginStartLock(normalizedEmail);
  if (!lock.ok) {
    await recordAuthEvent({ eventType: "login_otp_requested", success: false, ip: params.ip, userAgent: params.userAgent });
    return { ok: true, nextStep: "email_otp", challengeId: fallbackChallengeId };
  }

  try {
    return await startDashboardLoginUnlocked({ ...params, fallbackChallengeId });
  } finally {
    await releaseDashboardLoginStartLock(lock);
  }
}

async function startDashboardLoginUnlocked(params: {
  email: string;
  fallbackChallengeId: string;
  ip?: string;
  userAgent?: string;
}): Promise<DashboardLoginStartResult> {
  const result = await getOrCreateDashboardUserForLogin(params.email);
  if (!result || result.user.status !== "active") {
    await recordAuthEvent({
      eventType: "login_otp_requested",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: true, nextStep: "email_otp", challengeId: params.fallbackChallengeId };
  }

  const { user, created } = result;

  if (created) {
    await recordAuthEvent({
      userId: user.id,
      eventType: "account_auto_provisioned",
      success: true,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  }

  if (user.totpEnabled) {
    const challenge = issueDashboardLoginChallenge({ userId: user.id, stage: "totp_login" });
    return { ok: true, nextStep: "totp", challenge };
  }

  return await requestDashboardLoginOtpForUser({ user, fallbackChallengeId: params.fallbackChallengeId, ip: params.ip, userAgent: params.userAgent });
}
```

Add the database-backed lock in `authFlow.ts`:

```typescript
import { createHash, randomUUID } from "crypto";

const LOGIN_START_LOCK_PREFIX = "dashboard_login_start:";
const LOGIN_START_LOCK_STALE_MS = 120_000;
const LOGIN_START_LOCK_WAIT_MS = 150;
const LOGIN_START_LOCK_ATTEMPTS = 20;

function normalizeDashboardLoginEmailForLock(email: string): string {
  return email.trim().toLowerCase();
}

function dashboardLoginStartLockKey(normalizedEmail: string): string {
  return `${LOGIN_START_LOCK_PREFIX}${createHash("sha256").update(normalizedEmail).digest("hex")}`;
}

async function acquireDashboardLoginStartLock(
  normalizedEmail: string,
): Promise<{ ok: true; ownerToken: string; lockKey: string } | { ok: false }> {
  const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
  const lockKey = dashboardLoginStartLockKey(normalizedEmail);
  const ownerToken = randomUUID();

  for (let attempt = 0; attempt < LOGIN_START_LOCK_ATTEMPTS; attempt++) {
    const staleBefore = new Date(Date.now() - LOGIN_START_LOCK_STALE_MS).toISOString();
    await supabase.from("cron_locks").delete().eq("lock_key", lockKey).lt("started_at", staleBefore);
    const { error } = await supabase.from("cron_locks").insert({
      lock_key: lockKey,
      started_at: new Date().toISOString(),
      owner_token: ownerToken,
    });

    if (!error) return { ok: true, ownerToken, lockKey };
    if (error.code !== "23505") return { ok: false };
    await new Promise((resolve) => setTimeout(resolve, LOGIN_START_LOCK_WAIT_MS));
  }

  return { ok: false };
}

async function releaseDashboardLoginStartLock(lock: { ownerToken: string; lockKey: string }): Promise<void> {
  const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
  await supabase.from("cron_locks").delete().eq("lock_key", lock.lockKey).eq("owner_token", lock.ownerToken);
}

```

Extract the existing OTP creation/email-sending body into a private helper:

```typescript
async function requestDashboardLoginOtpForUser(params: {
  user: DashboardUser;
  fallbackChallengeId: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ ok: true; nextStep: "email_otp"; challengeId: string }> {
  if (await isDashboardLoginOtpRequestThrottled(params.user.id)) {
    await recordAuthEvent({ userId: params.user.id, eventType: "login_otp_requested", success: false, ip: params.ip, userAgent: params.userAgent });
    return { ok: true, nextStep: "email_otp", challengeId: params.fallbackChallengeId };
  }

  const existingOtp = await getLatestUsableDashboardEmailOtp(params.user.id);
  if (existingOtp.ok) {
    return { ok: true, nextStep: "email_otp", challengeId: existingOtp.challengeId };
  }

  const rawOtp = generateRawOtp();
  const createResult = await createDashboardEmailOtp({ userId: params.user.id, rawOtp });
  let challengeId = params.fallbackChallengeId;
  let success = false;

  if (createResult.ok) {
    challengeId = createResult.otpId;
    const sendResult = await sendDashboardOtpEmail({ to: params.user.email, otp: rawOtp });
    success = sendResult.ok;
    if (!sendResult.ok && sendResult.reason === "explicit_failure") {
      await invalidateDashboardEmailOtp(createResult.otpId);
      challengeId = params.fallbackChallengeId;
    }
  }

  await recordAuthEvent({ userId: params.user.id, eventType: "login_otp_requested", success, ip: params.ip, userAgent: params.userAgent });
  return { ok: true, nextStep: "email_otp", challengeId };
}
```

Remove `requestDashboardLoginOtp` after the route is migrated. Graph search showed its only production caller is `app/api/dashboard/auth/request-otp/route.ts`; tests must import `startDashboardLogin` directly. Do not keep a compatibility wrapper.

Update `lib/dashboardAuth/microsoftGraphOtp.ts` so `sendDashboardOtpEmail` returns:

```typescript
export type SendDashboardOtpEmailResult =
  | { ok: true }
  | { ok: false; reason: "explicit_failure" | "timeout_or_unknown" };
```

Rules:
- Missing from-address, token failure, or non-2xx Graph response -> `explicit_failure`.
- Thrown network/timeout/error after request construction -> `timeout_or_unknown`.
- Do not log OTP, email body, access token, or raw Graph response.

- [ ] **Step 4: Update route tests**

In `app/api/dashboard/auth/request-otp/route.test.tsx`, update the mock to use `startDashboardLogin` and cover both response shapes:

```typescript
startDashboardLogin.mockResolvedValue({ ok: true, nextStep: "email_otp", challengeId: "otp-123" });
expect(await response.json()).toEqual({ ok: true, nextStep: "email_otp", challengeId: "otp-123" });

startDashboardLogin.mockResolvedValueOnce({ ok: true, nextStep: "totp", challenge: "loginchallengev1_token" });
expect(await response.json()).toEqual({ ok: true, nextStep: "totp", challenge: "loginchallengev1_token" });
```

- [ ] **Step 5: Update the route implementation**

In `app/api/dashboard/auth/request-otp/route.ts`, import and call `startDashboardLogin`. Return its result directly:

```typescript
const result = await startDashboardLogin({ email, ip, userAgent });
return NextResponse.json(result, { status: 200 });
```

- [ ] **Step 6: Update the client**

In `components/dashboard-auth/dashboard-auth-client.tsx`, update the request response type:

```typescript
type RequestOtpResponse =
  | { ok: true; nextStep: "email_otp"; challengeId: string }
  | { ok: true; nextStep: "totp"; challenge: string }
  | { ok: false };
```

In `handleRequestOtp`, keep server authority:

```typescript
if (requestData.nextStep === "totp") {
  setChallenge(requestData.challenge);
  setOtpId("");
  setOtp("");
  setLoginCode("");
  setStep("login");
  return;
}

setOtpId(requestData.challengeId);
setOtp("");
setSetupCode("");
setLoginCode("");
setChallenge("");
setTotpSecret("");
setProvisioningUri("");
setStep("otp");
```

The browser must not infer first-time or returning status from the email string.

- [ ] **Step 7: Run focused verification**

Run:

```bash
npx vitest run lib/dashboardAuth/authFlow.test.ts
npx vitest run lib/dashboardAuth/microsoftGraphOtp.test.ts
npx vitest run app/api/dashboard/auth/request-otp/route.test.tsx
npx vitest run components/dashboard-auth
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS. Returning TOTP users send no email OTP; first-time users still receive OTP; no session exists before successful TOTP verification.
If OTP delivery fails for a newly auto-created user, verify the row remains `status = "active"` and `totp_enabled = false`, no session is created, and a later login can request OTP again without creating a duplicate user.

- [ ] **Step 8: Commit**

```bash
git add lib/dashboardAuth/authFlow.ts lib/dashboardAuth/authFlow.test.ts lib/dashboardAuth/microsoftGraphOtp.ts lib/dashboardAuth/microsoftGraphOtp.test.ts app/api/dashboard/auth/request-otp/route.ts app/api/dashboard/auth/request-otp/route.test.tsx components/dashboard-auth/dashboard-auth-client.tsx
git commit -m "feat: route returning dashboard users to authenticator login"
```

---

### Task 5: Wording Cleanup

**Files:**
- Modify: `components/dashboard-auth/dashboard-auth-client.tsx`
- Modify: `app/(operations)/ca-portfolio/ca-portfolio-client.tsx`
- Modify: `.env.example`

- [ ] **Step 1: Remove "Approved staff only."**

Delete this line from `components/dashboard-auth/dashboard-auth-client.tsx`:

```tsx
<p className="dashboard-auth-subtitle">Approved staff only.</p>
```

- [ ] **Step 2: Replace "Staff" with "CA"**

In `app/(operations)/ca-portfolio/ca-portfolio-client.tsx`, change:

```tsx
<label htmlFor="advisor-email">ApplyWizard Staff Email</label>
```

to:

```tsx
<label htmlFor="advisor-email">CA Email</label>
```

- [ ] **Step 3: Correct stale dashboard-secret wording**

In `.env.example`, replace the query-parameter comment with:

```text
# Used by the Basic Auth layer and dashboard auth route guard.
# This is not a query-string dashboard key.
```

- [ ] **Step 4: Verify wording scope**

Run:

```bash
rg -n "Approved staff only|ApplyWizard Staff Email|dashboard\\?secret" components app .env.example
npx vitest run components/dashboard-auth
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: `rg` finds no stale user-facing wording; tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard-auth/dashboard-auth-client.tsx "app/(operations)/ca-portfolio/ca-portfolio-client.tsx" .env.example
git commit -m "fix: remove staff-only dashboard wording"
```

---

### Task 6: Full Verification

- [ ] **Step 1: Run focused tests**

```bash
npx vitest run lib/dashboardAuth
npx vitest run app/api/dashboard
```

Expected: PASS.

- [ ] **Step 2: Run full regression checks**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
git status --short
```

Expected: tests pass, lint passes, build passes, diff check passes, and working tree is clean after commits.

- [ ] **Step 3: Local-only smoke check**

Run:

```bash
npm run dev
```

Use local/dev environment only, not Production. Verify:

1. New valid `@applywizz.ai` email creates a row, sends one email OTP, reaches authenticator setup, and creates no session before TOTP success.
2. Returning `totp_enabled=true` user goes from email directly to authenticator code and sends no OTP.
3. Existing disabled user sends no OTP, gets no TOTP challenge, creates no session, and is not reactivated.
4. External domain gets the generic response and creates no row.

- [ ] **Step 4: Stop for Codex review**

Do not push, merge, deploy, remove Basic Auth, access Production, create Production users, or enable Leads synchronization.

---

## Self-Review

**Corrected assumptions:**
- Existing TOTP users do not currently skip email OTP. Task 4 implements the approved shortcut.
- `verifyDashboardLoginOtp` only skips repeated QR setup after email OTP; that is not enough for approved returning login.
- Auto-provision audit must be emitted only when `created === true`.

**Spec coverage:**
- Admin role assignment -> Task 1.
- Both manager role assignments -> Task 1.
- Default CA role -> Task 1.
- Mixed-case normalization -> Task 1.
- External, subdomain, lookalike, empty-local, malformed rejection -> Task 1.
- New user auto-provisioning -> Task 2.
- Existing user unchanged -> Task 2.
- Inactive user blocked and not reactivated -> Tasks 2 and 4.
- Returning TOTP user skips email OTP -> Task 4.
- Returning TOTP user receives no OTP email -> Task 4.
- First-time user receives OTP and enters authenticator setup -> Task 4.
- First-time user sends one email and creates one OTP -> Task 4.
- Plus aliases blocked -> Task 1.
- No fake OTP ID for returning users -> Task 4.
- OTP delivery failure leaves an incomplete retryable account and no session -> Task 4.
- No duplicate account under concurrent requests -> Task 2.
- Real `23505` conflict recovery path -> Task 2.
- Auto-provision audit only for new users -> Task 4.
- Concurrent creation creates at most one true auto-provision audit, one OTP, and one email -> Task 4.
- Database OTP creation failure, explicit provider failure, and uncertain provider timeout behavior -> Task 4.
- No false audit event for existing users -> Task 4.
- No session before successful authentication -> Task 4.
- Existing role, status, TOTP secret, rate limits, session lifetime, and audit semantics are preserved -> Tasks 2 and 4.

**Scope check:**
- CA-only client-data filtering is excluded and must be implemented before broad dashboard access is granted to CA users.
- Manager-to-CA Router mapping is excluded.
- Basic Auth removal is excluded.
- Zoho OAuth recovery is excluded.
- Leads synchronization is excluded.
- Production deployment is excluded.

**Placeholder scan:** No unresolved markers, no placeholder code, and no source implementation in this plan commit.

**Type consistency:** `resolveAutoProvisionRole` returns normalized email and role. `getOrCreateDashboardUserForLogin` returns `{ user, created } | null`. `startDashboardLogin` consumes that result and returns either `email_otp` with `challengeId` or `totp` with `challenge`. The route and client consume the same union. There is no compatibility wrapper.
