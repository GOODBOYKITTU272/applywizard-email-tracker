# Dashboard Login Auto-Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the approved dashboard login flow: first-time `@applywizz.ai` users are created automatically with the correct role, returning authenticator users skip email OTP, and the UI stops using "staff" wording.

**Architecture:** Keep the existing dashboard auth routes, session code, OTP storage, TOTP setup/login code, and Basic Auth outer gate. Add one server-side role resolver, one idempotent user auto-provisioning helper, and one server-authoritative login-start branch that sends email OTP only for first-time setup. Do not add role pickers, new auth providers, or data-access filtering in this slice.

**Tech Stack:** Next.js Route Handlers, Supabase service-role client, Vitest.

## Global Constraints

- Auto-provisioning domain is exactly `@applywizz.ai`, case-insensitive after trimming and lowercasing.
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

- First-time users cannot currently self-create. `requestDashboardLoginOtp` calls `getDashboardUserByEmail`; missing rows get a fake OTP id and no email.
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
- Modify: `lib/dashboardAuth/authFlow.ts` — add login-start branching and precise audit event.
- Modify: `lib/dashboardAuth/authFlow.test.ts` — first-time flow, returning TOTP shortcut, no false audit, no session-before-auth tests.
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

  if (!localPart || !domain || extra !== undefined || domain !== STAFF_DOMAIN) {
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

- [ ] **Step 5: Commit**

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

- [ ] **Step 5: Commit**

```bash
git add lib/dashboardAuth/users.ts lib/dashboardAuth/users.test.ts
git commit -m "feat: auto-provision dashboard users"
```

---

### Task 3: Add Server-Authoritative Login Start Flow

**Files:**
- Modify: `lib/dashboardAuth/authFlow.ts`
- Modify: `lib/dashboardAuth/authFlow.test.ts`
- Modify: `app/api/dashboard/auth/request-otp/route.ts`
- Modify: `app/api/dashboard/auth/request-otp/route.test.tsx`
- Modify: `components/dashboard-auth/dashboard-auth-client.tsx`

**Interfaces:**
- Consumes: `getOrCreateDashboardUserForLogin(email)`.
- Produces:

```typescript
export type DashboardLoginStartResult =
  | { ok: true; nextStep: "email_otp"; otpId: string }
  | { ok: true; nextStep: "totp"; challenge: string };
```

Account-enumeration note: returning `nextStep: "totp"` reveals to someone who already passed Basic Auth that a submitted company email has an active TOTP dashboard account. This is accepted for the first release because the login is internal-only and still requires a valid authenticator code. External/nonexistent/disabled users must still receive the generic email-OTP-shaped response with no email sent.

- [ ] **Step 1: Write failing authFlow tests**

Add tests in `lib/dashboardAuth/authFlow.test.ts`:

```typescript
describe("startDashboardLogin", () => {
  it("auto-provisions a first-time applywizz user, sends email OTP, and creates no session", async () => {
    const { startDashboardLogin } = await import("./authFlow");
    const result = await startDashboardLogin({ email: "new.ca@applywizz.ai" });

    expect(result).toEqual({ ok: true, nextStep: "email_otp", otpId: expect.any(String) });
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

  it("records at most one auto-provision audit event when concurrent starts race", async () => {
    forceAutoProvisionRace({
      winner: { id: "race-user", email: "race@applywizz.ai", role: "ca", status: "active", totp_enabled: false },
      losingPathReturnsCreatedFalse: true,
    });

    const { startDashboardLogin } = await import("./authFlow");
    await Promise.all([
      startDashboardLogin({ email: "race@applywizz.ai" }),
      startDashboardLogin({ email: "race@applywizz.ai" }),
    ]);

    expect(audits.filter((event) => event.eventType === "account_auto_provisioned")).toHaveLength(1);
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

    expect(result).toEqual({ ok: true, nextStep: "email_otp", otpId: expect.any(String) });
    expect(sentEmails).toHaveLength(0);
    expect(createdOtps).toHaveLength(0);
    expect(sessions).toHaveLength(0);
  });
});
```

Keep existing OTP-verification tests: first-time users still go from email OTP to either `totp_setup_required` or `totp_required` depending on `totp_enabled`.
Also keep existing session and TOTP verification tests so session lifetime, TOTP attempt throttling, encrypted secret storage, and login audit behavior remain covered.

- [ ] **Step 2: Run the failing authFlow test**

Run: `npx vitest run lib/dashboardAuth/authFlow.test.ts`

Expected: FAIL with `startDashboardLogin is not a function`.

- [ ] **Step 3: Implement authFlow branching**

In `lib/dashboardAuth/authFlow.ts`, keep `verifyDashboardLoginOtp`, `completeDashboardTotpSetup`, and `verifyDashboardLoginTotp` intact. Replace normal callers of `requestDashboardLoginOtp` with a new exported `startDashboardLogin`.

Add:

```typescript
export type DashboardLoginStartResult =
  | { ok: true; nextStep: "email_otp"; otpId: string }
  | { ok: true; nextStep: "totp"; challenge: string };

export async function startDashboardLogin(params: {
  email: string;
  ip?: string;
  userAgent?: string;
}): Promise<DashboardLoginStartResult> {
  const fallbackOtpId = randomUUID();
  const result = await getOrCreateDashboardUserForLogin(params.email);

  if (!result || result.user.status !== "active") {
    await recordAuthEvent({
      eventType: "login_otp_requested",
      success: false,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { ok: true, nextStep: "email_otp", otpId: fallbackOtpId };
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

  return await requestDashboardLoginOtpForUser({ user, fallbackOtpId, ip: params.ip, userAgent: params.userAgent });
}
```

Extract the existing OTP creation/email-sending body into a private helper:

```typescript
async function requestDashboardLoginOtpForUser(params: {
  user: DashboardUser;
  fallbackOtpId: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ ok: true; nextStep: "email_otp"; otpId: string }> {
  if (await isDashboardLoginOtpRequestThrottled(params.user.id)) {
    await recordAuthEvent({ userId: params.user.id, eventType: "login_otp_requested", success: false, ip: params.ip, userAgent: params.userAgent });
    return { ok: true, nextStep: "email_otp", otpId: params.fallbackOtpId };
  }

  const rawOtp = generateRawOtp();
  const createResult = await createDashboardEmailOtp({ userId: params.user.id, rawOtp });
  let otpId = params.fallbackOtpId;
  let success = false;

  if (createResult.ok) {
    otpId = createResult.otpId;
    success = (await sendDashboardOtpEmail({ to: params.user.email, otp: rawOtp })).ok;
  }

  await recordAuthEvent({ userId: params.user.id, eventType: "login_otp_requested", success, ip: params.ip, userAgent: params.userAgent });
  return { ok: true, nextStep: "email_otp", otpId };
}
```

Keep a compatibility export only if existing tests or callers still import it:

```typescript
export async function requestDashboardLoginOtp(params: {
  email: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ ok: true; otpId: string }> {
  const result = await startDashboardLogin(params);
  return result.nextStep === "email_otp" ? { ok: true, otpId: result.otpId } : { ok: true, otpId: randomUUID() };
}
```

Do not use that compatibility wrapper from the route.

- [ ] **Step 4: Update route tests**

In `app/api/dashboard/auth/request-otp/route.test.tsx`, update the mock to use `startDashboardLogin` and cover both response shapes:

```typescript
startDashboardLogin.mockResolvedValue({ ok: true, nextStep: "email_otp", otpId: "otp-123" });
expect(await response.json()).toEqual({ ok: true, nextStep: "email_otp", otpId: "otp-123" });

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
  | { ok: true; nextStep: "email_otp"; otpId: string }
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

setOtpId(requestData.otpId);
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
npx vitest run app/api/dashboard/auth/request-otp/route.test.tsx
npx vitest run components/dashboard-auth
```

Expected: PASS. Returning TOTP users send no email OTP; first-time users still receive OTP; no session exists before successful TOTP verification.
If OTP delivery fails for a newly auto-created user, verify the row remains `status = "active"` and `totp_enabled = false`, no session is created, and a later login can request OTP again without creating a duplicate user.

- [ ] **Step 8: Commit**

```bash
git add lib/dashboardAuth/authFlow.ts lib/dashboardAuth/authFlow.test.ts app/api/dashboard/auth/request-otp/route.ts app/api/dashboard/auth/request-otp/route.test.tsx components/dashboard-auth/dashboard-auth-client.tsx
git commit -m "feat: route returning dashboard users to authenticator login"
```

---

### Task 4: Wording Cleanup

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
```

Expected: `rg` finds no stale user-facing wording; tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard-auth/dashboard-auth-client.tsx "app/(operations)/ca-portfolio/ca-portfolio-client.tsx" .env.example
git commit -m "fix: remove staff-only dashboard wording"
```

---

### Task 5: Full Verification

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
- Existing TOTP users do not currently skip email OTP. Task 3 implements the approved shortcut.
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
- Inactive user blocked and not reactivated -> Tasks 2 and 3.
- Returning TOTP user skips email OTP -> Task 3.
- Returning TOTP user receives no OTP email -> Task 3.
- First-time user receives OTP and enters authenticator setup -> Task 3.
- OTP delivery failure leaves an incomplete retryable account and no session -> Task 3.
- No duplicate account under concurrent requests -> Task 2.
- Real `23505` conflict recovery path -> Task 2.
- Auto-provision audit only for new users -> Task 3.
- Concurrent creation creates at most one true auto-provision audit -> Task 3.
- No false audit event for existing users -> Task 3.
- No session before successful authentication -> Task 3.
- Existing role, status, TOTP secret, rate limits, session lifetime, and audit semantics are preserved -> Tasks 2 and 3.

**Scope check:**
- CA-only client-data filtering is excluded and must be implemented before broad dashboard access is granted to CA users.
- Manager-to-CA Router mapping is excluded.
- Basic Auth removal is excluded.
- Zoho OAuth recovery is excluded.
- Leads synchronization is excluded.
- Production deployment is excluded.

**Placeholder scan:** No unresolved markers, no placeholder code, and no source implementation in this plan commit.

**Type consistency:** `resolveAutoProvisionRole` returns normalized email and role. `getOrCreateDashboardUserForLogin` returns `{ user, created } | null`. `startDashboardLogin` consumes that result and returns either `email_otp` or `totp`. The route and client consume the same union.
