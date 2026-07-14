# Dashboard Auth Phase B Basic Auth Removal Plan (Revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the dashboard-session authentication system with real Preview data, then remove Basic Auth without exposing protected dashboard routes.

**Architecture:** Phase B is a three-stage gated rollout — B1 (Preview setup and real database-backed E2E), B2 (Basic Auth removal implementation), B3 (production rollout). Per-page `requireDashboardSession()` guards remain the authoritative protection boundary for business pages throughout.

**Tech Stack:** Next.js App Router, Supabase service-role server helpers, Vercel Preview/Production env vars, Vitest, Playwright.

## Review Status

- Initial planning commit: `5b239ebea46b000c0a45c99c259c06c4392884db`
- Independent review verdict: `CHANGES REQUIRED` — no architecture rejection; six infrastructure/operational corrections required.
- This revision incorporates all six corrections. No production code is approved by this document.

## Global Constraints

- Plan only. Do not implement Phase B from this document without independent approval.
- Do not remove Basic Auth until Preview seeded-user verification and real database-backed E2E tests pass.
- Do not change production environment variables during planning.
- Do not seed production users during planning.
- Do not push or deploy from this planning task.
- Do not print, commit, or log secret values.
- Do not weaken `requireDashboardSession()` or duplicate session validation logic.
- Role-based authorization remains out of scope.

---

## A. Phase B Goal

Phase B has four exact objectives:

1. Verify the current dashboard-session system in Preview with an active seeded `admin_ceo` dashboard user.
2. Prove real database-backed valid-session, revocation, expiry, and soft-navigation denial behavior using isolated E2E tests.
3. Remove Basic Auth only after the new session system is proven and independently reviewed.
4. Preserve the existing protected business behavior:
   - `/overview` remains the authenticated landing page after login/setup.
   - `/dashboard` remains the standalone Email Tracker business UI.
   - All protected operations routes still require a usable dashboard session.
   - Rollback can restore the last Basic Auth deployment quickly.

Phase B must not be treated as a deploy instruction. Production rollout remains a later explicit approval gate.

## B. Current-State Analysis

### Single Supabase Configuration (Isolation Reality)

- The app reads exactly one Supabase target: `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` via `lib/supabase/serviceRole.ts`.
- The dashboard-auth migration was applied to the **production** Supabase project.
- The repository does not currently prove that any separate Preview Supabase project exists.
- Therefore, a Vercel Preview deployment inherits production database credentials unless Preview-scoped env vars are deliberately configured. Phase B1 must resolve this before any seeding or E2E (see Section C).

### Current Basic Auth Middleware Behavior

- `middleware.ts` enforces Basic Auth with username `admin` and `DASHBOARD_SECRET`.
- Current Basic Auth matcher covers:
  - `/dashboard/:path*`
  - `/overview`
  - `/live-monitor`
  - `/live-monitor/:path*`
  - `/clients/:path*`
  - `/operations/:path*`
  - `/review-queue`
- Because `/dashboard/:path*` is matched, `/dashboard/login` is still behind Basic Auth in Phase A.
- Middleware does not cover `/applications`, `/mailboxes`, or `/ca-portfolio`; those routes are protected by the new page-level dashboard-session guard.
- Middleware must not import `getDashboardSessionByToken()` or any `server-only` auth helper.

### Current Dashboard-Session Page Guards

- `lib/dashboardAuth/requireDashboardSession.ts` reads `dashboard_session` with `next/headers`.
- It calls the reviewed `getDashboardSessionByToken(rawToken)` helper.
- It returns the usable session only when the helper returns `ok: true`.
- It redirects to `/dashboard/login` for missing, fake, malformed, expired, revoked, disabled-user, missing-user, DB-failure, or exception paths.
- Protected pages call this helper independently; the operations layout is not the sole authorization boundary.

Current guarded pages:

- `app/dashboard/page.tsx`
- `app/(operations)/overview/page.tsx`
- `app/(operations)/live-monitor/email-arrival/page.tsx`
- `app/(operations)/clients/page.tsx`
- `app/(operations)/clients/[clientKey]/page.tsx`
- `app/(operations)/operations/page.tsx`
- `app/(operations)/operations/interviews/page.tsx`
- `app/(operations)/operations/interviews/[id]/page.tsx`
- `app/(operations)/review-queue/page.tsx`
- `app/(operations)/applications/page.tsx`
- `app/(operations)/applications/[applicationId]/page.tsx`
- `app/(operations)/mailboxes/page.tsx`
- `app/(operations)/ca-portfolio/page.tsx`

### Current Login, Setup, and Logout Flow

- `/dashboard/login` renders `DashboardAuthClient` unless a valid `dashboard_session` is already present; a valid session redirects to `/overview`.
- The client flow calls only the reviewed API routes: request-otp, verify-otp, complete-totp-setup, verify-totp.
- Successful setup/login relies on the `HttpOnly` `dashboard_session` cookie and navigates to `/overview`.
- `POST /api/dashboard/auth/logout` exists: Phase A Basic Auth gate first, Origin check, reads `dashboard_session`, revokes when present, ignores revocation result for response purposes, always clears the cookie, returns `200 { "ok": true }`.
- The operations navigation has a logout action that POSTs to the endpoint and hard-navigates to `/dashboard/login`.

### Current `/dashboard` Dependency on `DASHBOARD_SECRET`

- `app/dashboard/page.tsx` still includes a `DASHBOARD_SECRET` configuration check inherited from the Basic Auth era.
- Phase A intentionally retained this check; Phase B2 must explicitly review and remove or replace it.
- Removing the check must not change the restored Email Tracker business UI or its Supabase queries.

### Current Auth API Basic Auth Gates

The following routes still call `requireDashboardBasicAuth()`:

- `app/api/dashboard/auth/request-otp/route.ts`
- `app/api/dashboard/auth/verify-otp/route.ts`
- `app/api/dashboard/auth/complete-totp-setup/route.ts`
- `app/api/dashboard/auth/verify-totp/route.ts`
- `app/api/dashboard/auth/logout/route.ts`

### Current Environment-Secret Dependencies

- `DASHBOARD_SESSION_SECRET`
- `DASHBOARD_TOTP_ENCRYPTION_KEY`
- `DASHBOARD_LOGIN_CHALLENGE_SECRET`
- `MICROSOFT_TENANT_ID`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_OTP_FROM_EMAIL`
- `DASHBOARD_SECRET` retained during Phase A

No secret values belong in code, tests, docs, logs, state, or run-log files.

### Current Database Assumptions

- The dashboard auth migration defines `dashboard_users`, `dashboard_email_otps`, `dashboard_sessions`, `dashboard_auth_audit_events`.
- RLS is enabled; access is revoked from `public`, `anon`, and `authenticated`; service-role access is required.
- No dashboard user seed script currently exists in the repo.

### Current Missing E2E Coverage

Mandatory before Basic Auth removal:

1. Authenticate with a real seeded valid session and confirm `/dashboard` renders the Email Tracker business page identity.
2. Revoke or expire a real valid session in the database, soft-navigate to another protected route, and confirm denial.

Static route-guard tests and mocked session tests are regression tripwires, not substitutes for those real database-backed checks.

## C. Preview Database Isolation (Correction 1)

### Recommended and Default Path: Dedicated Preview Supabase Project

Provision a dedicated non-production Preview Supabase project before any Phase B1 testing.

Requirements:

- [ ] Apply the existing dashboard-auth migrations to the Preview project.
- [ ] Configure Vercel **Preview-scoped** environment variables (Preview environment only, never overwriting Production values):
  - `NEXT_PUBLIC_SUPABASE_URL` (Preview project)
  - `SUPABASE_SERVICE_ROLE_KEY` (Preview project)
  - `DASHBOARD_SESSION_SECRET`
  - `DASHBOARD_TOTP_ENCRYPTION_KEY`
  - `DASHBOARD_LOGIN_CHALLENGE_SECRET`
  - `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_OTP_FROM_EMAIL`
  - `DASHBOARD_SECRET` (retained for Phase A coexistence)
- [ ] Never use production database credentials in the Preview deployment.
- [ ] Verify the Preview Supabase project reference before running any seed or E2E tooling (allowlist check in tooling; see Section E).
- [ ] Verify all four auth tables exist in Preview (read-only `select count(*)` per table).
- [ ] Accept that business/Zoho tables may be absent in Preview: `/dashboard` and `/overview` may render empty/error business states there.
- [ ] E2E assertions for `/dashboard` and `/overview` must therefore target **page identity, authenticated shell, and route protection** — headings, layout shell, and redirect behavior — not production business-row counts.

### Fallback Path (Owner-Declined Only)

If a separate Preview Supabase project is explicitly declined by the owner, shared-production-database testing requires all of the following:

- Explicit owner approval of shared-database testing.
- An org-owned dedicated test email (never personal).
- **Mandatory** test-user disablement after every test run.
- **Mandatory** revocation of all sessions for the test user after every test run.
- Explicit written warning acknowledged by the owner: **the seeded test user is a real production login principal** until disabled.
- No Basic Auth removal (B2) while that user remains active.
- No automated mutation of unrelated production data — E2E tooling may touch only `dashboard_users`, `dashboard_sessions`, `dashboard_email_otps`, and `dashboard_auth_audit_events` rows belonging to the test user.
- Strong allowlisting in all tooling and recorded cleanup evidence for every run.

The dedicated Preview Supabase project is the recommended and default path; the fallback exists only as a documented owner-declined alternative.

## D. Preview Deployment Mechanism (Correction 3)

- Use `vercel deploy` from the local `worker-preflight` branch to create a Preview deployment.
- Do not push to or modify the `vercel-prod` remote.
- Do not deploy to production.
- Confirm the resulting URL is a Preview URL, not a production alias, before running any test.
- Check whether Vercel Deployment Protection is enabled for Preview deployments.
- If protected, use the approved deployment-protection bypass header (`x-vercel-protection-bypass`) or operator login in the headed test.
- Never print bypass-secret values in logs, evidence, or test output.

## E. User-Seeding Strategy (Seed-Script Specification)

Use a reviewed **one-off operator script**, not raw SQL. Production bootstrap must be a separate B3 artifact — this script has **no production mode at all**.

Required safety behavior:

- [ ] Require `DASHBOARD_AUTH_SEED_TARGET=preview` to run at all.
- [ ] Require `DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF` and `DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF`; both must be valid Supabase project refs and must differ.
- [ ] Require the project ref resolved from `NEXT_PUBLIC_SUPABASE_URL` to exactly equal `DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF` and not equal `DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF`, so pointing the script at production env vars fails even with the flag set.
- [ ] Refuse to run if the URL resembles or equals the production project.
- [ ] Read the test email from `DASHBOARD_TEST_ADMIN_EMAIL` (env var or CLI argument). Never hardcode a personal email.
- [ ] Normalize the email and upsert by `email_normalized`.
- [ ] Set: `role = 'admin_ceo'`, `status = 'active'`, `totp_enabled = false`, `totp_secret_encrypted = null`.
- [ ] Be idempotent — duplicate runs must not create multiple users for the same email.
- [ ] Output only: the normalized email and a created/updated status. Never print secrets, tokens, recovery codes, or encrypted TOTP values.
- [ ] Support a companion `--disable` mode: set the user's status to `disabled` and revoke all active sessions for that user with a reviewed service-role update scoped by exact `user_id` and `revoked_at is null`; do not import the server-only session store in CLI execution paths.
- [ ] Reject ambiguous mode combinations such as `--disable --dry-run` before creating a Supabase client.
- [ ] Preserve audit evidence — never delete audit rows.
- [ ] Require independent code review before first execution against any database.

## F. Real Database-Backed E2E Plan

These E2E tests run against a Preview deployment and the Preview Supabase project with a seeded test user. They must not run against production.

### Execution Model (Correction 2): Local, Operator-Assisted, Headed

Phase B1 E2E is **local and operator-assisted, not fully unattended CI**:

- The test launches headed Playwright against the Preview deployment URL.
- The operator reads the email OTP from the dedicated org-owned test mailbox.
- The operator enters the OTP into the headed browser.
- Scripted assertions continue automatically after OTP entry.
- TOTP setup codes are computed programmatically from the setup secret displayed during enrollment, using the same reference TOTP implementation already used in existing tests.
- Do not add Microsoft Graph mailbox-read automation in Phase B1.
- Automated Graph OTP retrieval may be considered later only if this E2E becomes recurring.
- The test command must require both `DASHBOARD_AUTH_E2E_TARGET=preview` and `DASHBOARD_AUTH_SEED_TARGET=preview`, because mandatory cleanup uses the same Preview-only disable path.
- The test command must require `DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF` and `DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF`, must verify they differ, and must refuse to run if the resolved Supabase URL points at the production ref.
- The test command must refuse to run if the URL is the production alias or a deceptive production-like hostname.

### Test Data Setup

- Confirm the Preview deployment URL (Section D).
- Confirm Preview env presence without printing values.
- Confirm auth tables exist in the Preview project.
- Seed or verify one active `admin_ceo` Preview test user (Section E).
- Use the org-owned non-production mailbox that can receive Microsoft OTP.
- Run TOTP enrollment using the normal `/dashboard/login` flow.
- Capture the `dashboard_session` cookie only inside the isolated test browser context.

### Mandatory E2E Cases

1. Authenticate using the real seeded valid user.
2. Confirm `/overview` loads after setup/login (page identity/authenticated shell).
3. Navigate to `/dashboard` and confirm the Email Tracker page identity renders.
4. Navigate to another protected route such as `/applications` or `/mailboxes` and confirm it loads.
5. Revoke or expire the current session in the Preview database.
6. Soft-navigate from one protected route to another protected sibling route.
7. Confirm access is denied and the browser reaches `/dashboard/login`.
8. Log in again, call logout, and confirm the session is revoked and the cookie is cleared.
9. Confirm post-logout protected-route access is denied.
10. Before Basic Auth removal, confirm Basic Auth and dashboard session coexist:
    - Basic Auth alone does not satisfy `requireDashboardSession()`.
    - Dashboard session alone does not bypass Phase A Basic Auth where Basic Auth still applies.
    - Same-origin auth API requests still work after the browser passes Basic Auth.

### Revocation/Expiry Mechanism

- Preferred: a local test utility that receives the raw session cookie inside the test process, uses the existing HMAC hashing helper locally to identify the session, and uses the service-role Preview client to set `revoked_at` or an expired `expires_at`.
- Never print token or hash values.
- Do not add a production route or public test-only endpoint for session mutation.

### Mandatory Cleanup (Correction 5)

After **every** Phase B1 E2E run, without exception:

- [ ] Disable the seeded Preview test user.
- [ ] Revoke all sessions for that user.
- [ ] Retain sanitized audit events as evidence — do not delete audit history merely for cleanup.
- [ ] Record cleanup success in the evidence document.
- [ ] **If cleanup fails, Phase B1 is considered failed and must not unlock Phase B2.**

Cleanup is mandatory even with an isolated Preview database — it is hygiene, not merely risk mitigation.

### Evidence Requirements

Record durable sanitized evidence in `STATE.md` or a dedicated evidence document:

- Preview URL identifier (without secrets or bypass tokens).
- Preview Supabase project identifier/reference, sanitized where necessary.
- Seed script result (normalized email + created/updated).
- OTP-assisted login result.
- `/overview` authenticated result.
- `/dashboard` page identity result.
- Another protected route result.
- Session revocation result.
- Revoke-then-soft-navigation denial result.
- Logout result.
- Post-logout denial result.
- Test-user disablement result.
- Revoke-all cleanup result.
- Confirmation that no production data was mutated.

Never record OTPs, TOTP secrets, session tokens, cookies, service-role keys, or bypass secrets.

## G. Phase Structure and Gates (Correction 6)

### Phase B1 — Preview Setup and Real E2E

Scope:

- [ ] Provision or confirm the dedicated Preview Supabase project (Section C).
- [ ] Configure Preview-scoped Vercel environment values.
- [ ] Review and build the Preview-only seed script (Section E).
- [ ] Review and build the local revocation/cleanup tooling (Section F).
- [ ] Deploy current Phase A to Vercel Preview via `vercel deploy` (Section D).
- [ ] Run the operator-assisted real DB-backed E2E (Section F).
- [ ] Record sanitized evidence.
- [ ] Disable the test user and revoke all sessions (mandatory).

No Basic Auth removal in B1.

Entry gate:

- Revised plan approved by independent review.
- Owner authorizes the dedicated Preview Supabase project and the test mailbox.

Exit gate:

- Preview E2E passes all mandatory cases.
- `/overview` loads with a real session.
- `/dashboard` shows the Email Tracker page identity.
- Revocation followed by soft navigation is denied.
- Logout revokes and denies later access.
- Cleanup succeeds (disable + revoke-all recorded).
- Independent review of B1 tooling and evidence.

### Phase B2 — Basic Auth Removal Implementation

Scope:

- [ ] Remove Basic Auth from `middleware.ts`.
- [ ] Remove Basic Auth gates from the five dashboard-auth API routes.
- [ ] Remove or replace the `/dashboard` `DASHBOARD_SECRET` dependency.
- [ ] Update tests and documentation (including `.env.example`; see Section L).
- [ ] Keep all per-page dashboard session guards.
- [ ] Keep logout Origin protection.
- [ ] Keep cookie and session validation behavior.

Entry gate:

- B1 evidence approved.
- Vercel WAF plan finalized (Section J).
- Explicit owner approval.

Exit gate:

- Full automated suite passes.
- Independent code/security review passes.
- Post-removal Preview smoke passes.

### Phase B3 — Production Rollout

Scope:

- [ ] Verify production secrets and schema by presence/status only.
- [ ] Seed the real production admin user using a separately reviewed production bootstrap artifact (not the B1 script).
- [ ] Configure the Vercel WAF rate-limit rule (Section J).
- [ ] Create rollback tag: `phase-a-basic-auth-final`.
- [ ] Deploy only with explicit owner approval.
- [ ] Run production smoke tests.
- [ ] Monitor rollback criteria.
- [ ] Retain `DASHBOARD_SECRET` for 14 days after production deployment, or until a full login/logout cycle is verified and the owner signs off, whichever is later.

Entry gate:

- B2 approved and Preview verified post-removal.
- Production admin email approved.
- Production deployment explicitly approved.

## H. Exact Basic Auth Removal Scope (B2)

The B2 implementation may touch only these areas unless review finds a concrete blocker:

- `middleware.ts`
  - Remove Basic Auth challenge/validation from protected dashboard routes.
  - If middleware has no remaining required behavior, remove or shrink it after confirming unrelated routes are unaffected.
  - Do not add dashboard-session validation to middleware.
- Dashboard auth API routes:
  - Remove `requireDashboardBasicAuth()` calls from request OTP, verify OTP, complete TOTP setup, verify TOTP, and logout.
  - Preserve JSON validation, rate limiting, OTP/TOTP flows, challenge requirements, cookie behavior, Origin check, and generic failures.
- `app/api/dashboard/auth/_lib/basicAuthGate.ts`
  - Delete only if no imports remain.
  - Delete or rewrite tests that only assert the removed Basic Auth gate.
- `app/dashboard/page.tsx`
  - Remove or replace the `DASHBOARD_SECRET` configuration check.
  - Preserve the page-level `requireDashboardSession()` guard.
  - Preserve the Supabase-backed Email Tracker business UI.
- Tests:
  - Remove or update tests expecting Basic Auth 401 on dashboard/login/auth APIs.
  - Remove Playwright `httpCredentials` only after route behavior is updated.
  - **Replace** the Phase A coexistence tests with their post-removal equivalents:
    - public login page test,
    - public auth API test,
    - protected pages deny without dashboard session.
- Documentation/env files:
  - Update `.env.example` and docs to mark `DASHBOARD_SECRET` as rollback-only after the rollback window.
  - Do not delete the actual Vercel env var until owner approves after production stability.
- Deployment settings:
  - Do not modify Vercel project settings except through explicit rollout steps.

Do not remove or weaken:

- `requireDashboardSession()`
- `getDashboardSessionByToken()`
- `dashboard_session` cookie security attributes
- OTP/TOTP rate limits
- login challenge validation
- logout Origin check

## I. Post-Removal Route Policy

After Basic Auth removal:

- `/dashboard/login` is publicly reachable.
- `/api/dashboard/auth/*` is publicly reachable, subject to strict JSON validation, OTP/TOTP throttling, signed login challenges, generic failure responses, and the B3 WAF rate limit.
- Protected business pages still require a valid usable `dashboard_session`.
- `/overview` remains the post-login landing page.
- `/dashboard` remains a protected Email Tracker business page.
- Static assets, `/_next/*`, metadata, and unrelated APIs remain unaffected.
- Unrelated APIs (Zoho cron, worker, test, sync, classification) remain untouched, period.
- Invalid sessions redirect to `/dashboard/login`.
- A valid session visiting `/dashboard/login` redirects to `/overview`.
- Redirects must not include attacker-controlled destinations; no open redirect support.
- Redirect loops must be tested:
  - `/dashboard/login` with no/invalid session renders login.
  - Protected routes with no/invalid session redirect to `/dashboard/login`.
  - `/dashboard/login` with valid session redirects once to `/overview`.

## J. Security Analysis

### WAF Rate Limiting (Correction 4) — B3 Prerequisite

- Configure a Vercel WAF rate-limit rule for `/api/dashboard/auth/*`.
- Recommended starting policy: approximately **20 requests per minute per IP**.
- The exact threshold may be adjusted after Preview testing.
- Not required for Phase B1 (Basic Auth remains active).
- **Blocking before Basic Auth removal reaches production (B3).**
- Do not add application-level IP rate limiting in this slice unless later evidence requires it.
- Retain all existing per-user OTP send limits, OTP attempt counts, and TOTP failure throttles unchanged.

Rationale: per-user throttles are strong, but the public `request-otp` endpoint performs a DB lookup and an audit-event insert per anonymous request; an IP-level platform rule bounds write amplification and cost without new application code.

### Fail-Closed Behavior

- Protected pages must continue using `requireDashboardSession()`.
- Any missing cookie, invalid token, expired session, revoked session, disabled user, missing user, DB error, or unexpected exception denies access.
- Auth APIs return generic failures only.

### Database Outage Behavior

- During a DB outage, `getDashboardSessionByToken()` returns `{ ok: false }`; protected pages redirect to `/dashboard/login`; login fails generically. This is an availability failure, not fail-open.

### Brute Force, Login Challenge Abuse, TOTP Replay

- OTP request throttling remains backed by audit events; email OTP verification uses hashed OTPs, expiry, attempt counts, and generic responses.
- TOTP setup/login throttling remains required (6-digit codes, ±1 time-step tolerance).
- Removing Basic Auth increases auth API exposure: B2 must re-run all rate-limit tests and add public-endpoint abuse-path tests.
- TOTP setup/login must continue deriving trusted `userId` and setup secret only from signed encrypted login challenges (short-lived, stage-bound, never logged, never in URLs or browser storage).
- TOTP setup persists the encrypted secret only after proof-of-possession. Re-enrollment/reset flows remain out of scope unless separately approved.

### Session Fixation, Cookie Replay, Secret Rotation

- `dashboard_session` is set only server-side after successful TOTP setup/login; tokens are random, hashed in DB, HttpOnly, SameSite=Lax, Path=/, Secure in production.
- Replayed cookies are valid only until expiry/revocation and only while the DB session remains usable.
- `DASHBOARD_SESSION_SECRET` rotation invalidates existing session hashes unless a dual-secret migration is designed; `DASHBOARD_TOTP_ENCRYPTION_KEY` rotation requires re-encryption or re-enrollment; `DASHBOARD_LOGIN_CHALLENGE_SECRET` rotation invalidates in-flight challenges only; Microsoft client secret rotation affects OTP delivery. Do not rotate secrets in Phase B.
- `DASHBOARD_SECRET` remains available during the rollback window after Basic Auth removal.

### Seeded-User Compromise

- Disable the `dashboard_users` row; revoke all sessions; rotate TOTP enrollment if needed; review audit events.

### Logout CSRF

- Keep the Origin check. Missing Origin may remain allowed for compatibility; `Origin: null` fails closed as in Phase A. No state-changing GET logout.

### Sensitive Logging

Never log: Basic Auth credentials, OTPs, TOTP codes, TOTP secrets, provisioning URIs, login challenges, session tokens, session hashes, Microsoft tokens, raw provider errors, deployment-protection bypass secrets.

### Direct RSC, Static Generation, and Middleware Bypass

- Protected pages must stay dynamic and call `requireDashboardSession()` before loading data.
- A layout-only guard is insufficient; every protected page keeps its own guard.
- Basic Auth removal must not create any reliance on middleware for session authorization.

### Admin Lockout Recovery

- Keep the rollback deployment/commit ready and `DASHBOARD_SECRET` available during the rollback window.
- Maintain a service-role operator path to seed/enable an `admin_ceo` user.
- Document how to revoke sessions and reset TOTP for the admin user without exposing secrets.

## K. Rollback Plan

- Rollback checkpoint: tag `phase-a-basic-auth-final` on the last known Phase A deployment/commit before Basic Auth removal.
- Fast restore: redeploy the Phase A commit or revert the B2 removal commit.
- Keep `DASHBOARD_SECRET` configured until the rollback window closes (14 days post-production or verified cycle + owner sign-off, whichever is later).
- Do not roll back the database schema; Phase B requires no schema changes.
- To invalidate app-owned sessions globally: set `revoked_at = now()` on active `dashboard_sessions` rows through an approved service-role operator path.
- To disable a compromised user: set `dashboard_users.status = 'disabled'` and revoke that user's sessions.
- Rollback triggers:
  - Admins cannot log in.
  - Protected pages become public.
  - OTP email delivery fails broadly.
  - Session revocation/logout fails.
  - Production DB auth queries fail beyond the accepted window.
  - Sensitive values appear in logs.
- After rollback, confirm Basic Auth 401/200 behavior and protected dashboard access.

## L. Test Plan

### Existing Automated Suites

- `npx vitest run`
- `npx playwright test tests/dashboard-auth.spec.ts --project=desktop`
- `npm run lint`
- `npm run build`
- `git diff --check`

### Phase A Regression Tests

- Existing auth API route tests, `lib/dashboardAuth` tests, route guard coverage tests, logout route/UI tests, and the dashboard-auth Playwright suite.

### Real DB-Backed E2E (B1)

See Section F — all ten mandatory cases plus mandatory cleanup and evidence.

### Basic Auth Removal Tests (B2)

- `/dashboard/login` no longer requires Basic Auth.
- Dashboard auth APIs no longer require Basic Auth.
- Protected pages still deny without dashboard session.
- Basic Auth headers no longer determine dashboard access.
- `DASHBOARD_SECRET` absence no longer blocks `/dashboard` after its page check is removed.
- No route becomes public by mistake.
- Phase A coexistence tests are **replaced** with: public login page test, public auth API test, protected-pages-deny-without-session test.

### Public Login/API Tests

- Missing/malformed JSON still returns generic `{ ok: false }`.
- Unknown/disabled/throttled users remain enumeration-safe.
- OTP/TOTP failures remain generic.
- Session token is never returned in JSON.
- Challenge, OTP, TOTP code, provisioning URI, and session token are not logged.

### Protected Route Tests

- No cookie, fake cookie, malformed cookie, expired session, revoked session, disabled user, missing user, database failure, valid session — across all protected route categories including `/applications`, `/mailboxes`, `/ca-portfolio`.

### Logout Tests

- Valid cookie revokes; no cookie succeeds; malformed cookie succeeds; already-revoked succeeds; double logout succeeds; cookie clears; post-logout access denied; Origin mismatch returns generic `{ ok: false }`.

### Secret-Missing and DB-Failure Tests

- Missing session/TOTP/challenge/Microsoft env vars fail closed where applicable.
- Missing `DASHBOARD_SECRET` no longer matters after B2.
- DB failures deny protected pages and produce generic login failures.

### Smoke Tests

- Preview smoke before removal: Basic Auth active; login flow works behind Basic Auth; same-origin API calls work; session guard protects pages beneath Basic Auth.
- Preview smoke after removal: login route public; auth APIs public; protected pages deny without session; valid session reaches `/overview`, `/dashboard`, one more protected route; logout denies later access.
- Production smoke after explicit approval: same as post-removal Preview smoke, using the approved production `admin_ceo` user.

### `.env.example` (B2 Only)

- During B2, add the eight dashboard-auth environment variable names as placeholders in `.env.example` (`DASHBOARD_SESSION_SECRET`, `DASHBOARD_TOTP_ENCRYPTION_KEY`, `DASHBOARD_LOGIN_CHALLENGE_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_OTP_FROM_EMAIL`, `DASHBOARD_SECRET` marked rollback-only). Placeholders only — never real values.

## M. Explicit Out of Scope

- Role-based authorization.
- Manager Ops or CA data scoping.
- New access-denied UI.
- Password login.
- TOTP reset/recovery UI unless separately approved.
- Email classification changes.
- Worker changes.
- Zoho ingestion/sync changes.
- Review queue redesign.
- Database schema unrelated to auth.
- New deployment platform.
- New package dependencies unless a blocker is documented and approved.
- Application-level IP rate limiting (WAF handles it; see Section J).
- Production deployment during this planning task.
- Production user seeding during this planning task.
- Removing or changing session hashing/encryption primitives.

## N. Owner-Decision Table (Recommended Defaults Encoded)

| Decision | Recommended choice | Gate |
| --- | --- | --- |
| Preview database | Dedicated Preview Supabase project | Before B1 |
| Preview test email | Dedicated org-owned test mailbox | Before B1 |
| Seed method | Reviewed one-off operator script | Before B1 |
| Re-seed behavior | Reset Preview test user TOTP fields | Before B1 |
| E2E execution | Local headed operator-assisted | Before E2E |
| Revocation method | Local service-role utility | Before E2E |
| OTP mailbox owner | Owner/operator | Before E2E |
| Post-test cleanup | Mandatory disable and revoke-all | Before B2 |
| Audit rows | Retain | Non-blocking |
| Production admin email | Real staff email, different from test user | Before B3 |
| `DASHBOARD_SECRET` retention | 14 days or verified cycle plus sign-off, whichever is later | Before B3 |
| Rollback tag | `phase-a-basic-auth-final` | Before B3 |
| B2 approval | Owner after independent review | Before B2 |
| Production approval | Owner | Before B3 |

### Active Owner Inputs Still Required Now

Only two decisions require active owner input before B1 can begin:

1. **Authorize creation/use of a dedicated Preview Supabase project.**
2. **Choose or create the dedicated org-owned Preview OTP mailbox.**

The production admin email decision is deferred until B3. All other decisions carry the recommended defaults above and require only assent.

## Self-Review Checklist

- This plan does not implement Phase B.
- This plan does not remove Basic Auth.
- This plan does not seed users.
- This plan does not change env vars.
- This plan does not deploy.
- It resolves the Preview database-isolation reality explicitly (Section C).
- It specifies the OTP-retrieval mechanism (Section F).
- It names the Preview deployment mechanism (Section D).
- It adds the WAF rate-limit rule as a B3 prerequisite (Section J).
- It makes post-E2E cleanup mandatory with a failure consequence (Section F).
- It formalizes B1/B2/B3 gates (Section G).
- It names all known Basic Auth removal touchpoints (Section H).
- It keeps `requireDashboardSession()` as the page-level security boundary.
- It requires real database-backed Preview E2E before Basic Auth removal.
- It preserves `/overview` landing and `/dashboard` business UI behavior.
