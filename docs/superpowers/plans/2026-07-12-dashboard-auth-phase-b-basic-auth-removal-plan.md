# Dashboard Auth Phase B Basic Auth Removal Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the dashboard-session authentication system with real Preview data, then remove Basic Auth without exposing protected dashboard routes.

**Architecture:** Phase B is a two-stage rollout: first seed and verify a real Preview dashboard user and database-backed session behavior, then remove the Basic Auth gates in a separately reviewed implementation commit. Per-page `requireDashboardSession()` guards remain the authoritative protection boundary for business pages.

**Tech Stack:** Next.js App Router, Supabase service-role server helpers, Vercel Preview/Production env vars, Vitest, Playwright.

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

Current guarded pages include:

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

### Current Login and Setup Flow

- `/dashboard/login` renders `DashboardAuthClient` unless a valid `dashboard_session` is already present.
- A valid session at `/dashboard/login` redirects to `/overview`.
- The client flow calls only the reviewed API routes:
  - `POST /api/dashboard/auth/request-otp`
  - `POST /api/dashboard/auth/verify-otp`
  - `POST /api/dashboard/auth/complete-totp-setup`
  - `POST /api/dashboard/auth/verify-totp`
- Successful setup/login relies on the `HttpOnly` `dashboard_session` cookie and navigates to `/overview`.

### Current Logout Flow

- `POST /api/dashboard/auth/logout` exists.
- During Phase A it calls `requireDashboardBasicAuth()` first.
- It checks `Origin`, reads `dashboard_session`, calls `revokeDashboardSession(rawToken)` when present, ignores revocation result for response purposes, clears the cookie, and returns `200 { "ok": true }`.
- The operations navigation has a logout action that POSTs to the endpoint and hard-navigates to `/dashboard/login`.

### Current `/dashboard` Dependency on `DASHBOARD_SECRET`

- `app/dashboard/page.tsx` still includes a `DASHBOARD_SECRET` configuration check inherited from the Basic Auth era.
- Phase A intentionally retained this check.
- Phase B must explicitly review and remove or replace this check after Basic Auth removal is otherwise proven.
- Removing the check must not change the restored Email Tracker business UI or its Supabase queries.

### Current Auth API Basic Auth Gates

The following routes still call `requireDashboardBasicAuth()`:

- `app/api/dashboard/auth/request-otp/route.ts`
- `app/api/dashboard/auth/verify-otp/route.ts`
- `app/api/dashboard/auth/complete-totp-setup/route.ts`
- `app/api/dashboard/auth/verify-totp/route.ts`
- `app/api/dashboard/auth/logout/route.ts`

### Current Environment-Secret Dependencies

Dashboard auth currently depends on:

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

- The dashboard auth migration is live and defines:
  - `dashboard_users`
  - `dashboard_email_otps`
  - `dashboard_sessions`
  - `dashboard_auth_audit_events`
- RLS is enabled; access is revoked from `public`, `anon`, and `authenticated`.
- Service-role access is required for server helpers.
- No dashboard user seed script currently exists in the repo.

### Current Missing E2E Coverage

The following remain mandatory before Basic Auth removal:

1. Authenticate with a real seeded valid session and confirm `/dashboard` renders the Email Tracker business UI.
2. Revoke or expire a real valid session in the database, soft-navigate to another protected route, and confirm denial.

Static route-guard tests and mocked session tests are regression tripwires, not substitutes for those real database-backed checks.

## C. Preview Environment Prerequisites

Before any Phase B implementation:

- Vercel Preview must have Sensitive env vars present for:
  - `DASHBOARD_SESSION_SECRET`
  - `DASHBOARD_TOTP_ENCRYPTION_KEY`
  - `DASHBOARD_LOGIN_CHALLENGE_SECRET`
  - `MICROSOFT_TENANT_ID`
  - `MICROSOFT_CLIENT_ID`
  - `MICROSOFT_CLIENT_SECRET`
  - `MICROSOFT_OTP_FROM_EMAIL`
  - `DASHBOARD_SECRET` retained initially for Phase A coexistence
- The target Preview Supabase project must contain the four dashboard auth tables.
- At least one active `admin_ceo` dashboard user must exist in `dashboard_users`.
- The seeded test user must use an approved non-production staff/test mailbox capable of receiving Microsoft Graph OTP emails.
- TOTP setup must be performed through the normal login/setup flow unless an owner-approved test bootstrap process is created.
- Secret presence verification must use presence-only output, such as Vercel env listing or a boolean diagnostic. Never print values.
- Preview must be clearly identified so tests cannot accidentally run against production.

## D. User-Seeding Strategy

No reusable dashboard-user operator script exists today. Phase B implementation must include one of these owner-approved approaches before testing:

1. Add a one-off, preview-safe operator script that upserts one dashboard user.
2. Run an explicitly reviewed SQL statement against Preview only.

Recommended implementation approach:

- Create a small operator script only if owner approves it.
- Require an explicit environment guard such as `DASHBOARD_AUTH_SEED_TARGET=preview`.
- Require the email through an env var or CLI argument such as `DASHBOARD_TEST_ADMIN_EMAIL`.
- Refuse to run if the target appears to be production unless a separate production-specific approval flag is provided in a later rollout step.
- Normalize email to lowercase through existing helper semantics.
- Upsert by `email_normalized`.
- Insert/update fields:
  - `email`
  - `role = 'admin_ceo'`
  - `status = 'active'`
  - `totp_enabled = false` for first enrollment unless reusing an existing test user
  - `totp_secret_encrypted = null` for first enrollment unless owner approves preserving an existing secret
- Duplicate runs must be idempotent and must not create multiple users for the same email.
- The script must not log personal data beyond the approved test email and must never log secrets.
- Cleanup must disable the test user or delete it only if owner approves audit/history loss.
- Cleanup must revoke all sessions for the user with `revokeDashboardSessionsForUser(userId)` or an equivalent reviewed service-role update.
- Production seeding is explicitly prohibited during this planning task.

## E. Real Database-Backed E2E Plan

These E2E tests must run against a Preview deployment and Preview Supabase project with a seeded test user. They must not run against production.

### Test Data Setup

- Confirm the Preview deployment URL.
- Confirm Preview env presence without printing values.
- Confirm auth tables exist.
- Seed or verify one active `admin_ceo` Preview test user.
- Use a non-production mailbox that can receive Microsoft OTP.
- Run TOTP enrollment using the normal `/dashboard/login` flow.
- Capture the `dashboard_session` cookie only inside the isolated test browser context.

### Mandatory E2E Cases

1. Authenticate using the real seeded valid user.
2. Confirm `/overview` loads after setup/login.
3. Navigate to `/dashboard` and confirm the Email Tracker business UI renders.
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

Use one of these reviewed, Preview-only mechanisms:

- Preferred: a test utility that receives the raw session cookie inside the test process, calls the existing `getDashboardSessionByToken(rawToken)` helper to identify the session, and uses the service-role Preview client to set `revoked_at` or an expired `expires_at`.
- Alternative: a tightly scoped SQL update against Preview that identifies the session through the same HMAC hashing helper locally, never by printing token/hash values.

Do not add a production route or public test-only endpoint for session mutation.

### Test Isolation and Cleanup

- Each E2E run should use a fresh browser context.
- Revoke all sessions for the test user after the run.
- Leave audit rows intact unless an owner-approved cleanup policy says otherwise.
- Disable or remove the test user after testing only if owner approves.
- On failure, capture only sanitized screenshots/logs; do not capture OTPs, TOTP codes, challenge tokens, session tokens, cookies, or secrets.

### CI and Local Execution

- The real DB-backed E2E may run locally against Preview or in CI against Preview.
- CI requires secrets to be provided as masked CI env vars.
- The test command must require an explicit target variable such as `DASHBOARD_AUTH_E2E_TARGET=preview`.
- The command must refuse to run if the URL is the production alias.

## F. Exact Basic Auth Removal Scope

After Preview proof and explicit approval, the Basic Auth removal implementation may touch only these areas unless review finds a concrete blocker:

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
  - Add tests proving public login/API access and protected page denial without Basic Auth.
- Documentation/env files:
  - Update `.env.example` and docs to mark `DASHBOARD_SECRET` as rollback-only or no longer required after the rollback window.
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

## G. Post-Removal Route Policy

After Basic Auth removal:

- `/dashboard/login` is publicly reachable.
- `/api/dashboard/auth/*` is publicly reachable, subject to strict JSON validation, OTP/TOTP throttling, signed login challenges, and generic failure responses.
- Protected business pages still require a valid usable `dashboard_session`.
- `/overview` remains the post-login landing page.
- `/dashboard` remains a protected Email Tracker business page.
- Static assets, `/_next/*`, metadata, and unrelated APIs remain unaffected.
- Zoho cron, worker, test, sync, and classification APIs must not be changed as part of Basic Auth removal.
- Invalid sessions redirect to `/dashboard/login`.
- A valid session visiting `/dashboard/login` redirects to `/overview`.
- Redirects must not include attacker-controlled destinations; no open redirect support should be added.
- Redirect loops must be tested:
  - `/dashboard/login` with no/invalid session renders login.
  - Protected routes with no/invalid session redirect to `/dashboard/login`.
  - `/dashboard/login` with valid session redirects once to `/overview`.

## H. Security Analysis

### Fail-Closed Behavior

- Protected pages must continue using `requireDashboardSession()`.
- Any missing cookie, invalid token, expired session, revoked session, disabled user, missing user, DB error, or unexpected exception denies access.
- Auth APIs return generic failures only.

### Database Outage Behavior

- During a DB outage, `getDashboardSessionByToken()` returns `{ ok: false }`.
- Protected pages redirect to `/dashboard/login`.
- Login flows may fail generically.
- This is an availability failure, not a fail-open condition.

### Brute Force and Rate Limiting

- OTP request throttling remains backed by audit events.
- Email OTP verification uses hashed OTPs, expiry, attempt counts, and generic responses.
- TOTP setup/login throttling remains required because codes are 6 digits with ±1 time-step tolerance.
- Removing Basic Auth increases exposure of auth APIs, so Phase B must re-run all rate-limit tests and add public-endpoint abuse-path tests.

### Login Challenge Abuse

- TOTP setup/login must continue deriving trusted `userId` and setup secret only from signed encrypted login challenges.
- Challenge tokens are short-lived and stage-bound.
- Challenge tokens must not be logged, persisted in browser storage, or placed in URLs.

### TOTP Replay

- TOTP codes are time-window valid; rate limiting and generic failures remain the main defenses.
- TOTP setup persists the encrypted secret only after proof-of-possession.
- Re-enrollment/reset flows remain out of scope unless owner approves a separate plan.

### Session Fixation and Cookie Replay

- Routes must set `dashboard_session` only after successful TOTP setup/login.
- Session tokens are random, hashed in DB, HttpOnly, SameSite=Lax, Path=/, and Secure in production.
- No client-controlled cookie writing should be introduced.
- Replayed cookies are valid only until expiry/revocation and only if the DB session remains usable.

### Secret Rotation

- `DASHBOARD_SESSION_SECRET` rotation invalidates existing session hashes unless a dual-secret migration is designed.
- `DASHBOARD_TOTP_ENCRYPTION_KEY` rotation requires re-encryption or forced re-enrollment.
- `DASHBOARD_LOGIN_CHALLENGE_SECRET` rotation invalidates in-flight login challenges only.
- Microsoft Graph client secret rotation affects OTP delivery.
- `DASHBOARD_SECRET` should remain available during the rollback window even after Basic Auth removal.

### Seeded-User Compromise

- Disable the `dashboard_users` row.
- Revoke all active sessions for that user.
- Rotate TOTP enrollment if needed.
- Review audit events for suspicious failures.

### Logout CSRF

- Logout is idempotent and clears the session.
- Keep the Origin check.
- Missing Origin may remain allowed for compatibility; `Origin: null` should fail closed as it does in Phase A.
- Do not add state-changing GET logout.

### Sensitive Logging

Never log:

- Basic Auth credentials
- OTPs
- TOTP codes
- TOTP secrets
- provisioning URIs
- login challenges
- session tokens
- session hashes
- Microsoft tokens
- raw provider errors

### Direct RSC, Static Generation, and Middleware Bypass

- Protected pages must stay dynamic where needed and must call `requireDashboardSession()` before loading data.
- A layout-only guard is insufficient; every protected page keeps its own guard.
- Basic Auth removal must not create any reliance on middleware for session authorization.

### Admin Lockout Recovery

Before production rollout, define a recovery procedure:

- Keep rollback deployment or commit ready.
- Keep `DASHBOARD_SECRET` available during rollback window.
- Maintain a service-role operator path to seed/enable an `admin_ceo` user.
- Document how to revoke sessions and reset TOTP for the admin user without exposing secrets.

## I. Rollout Sequence

1. Prepare Preview secrets and verify presence only.
2. Verify the auth tables exist in Preview Supabase.
3. Seed one active Preview `admin_ceo` test user through the approved process.
4. Deploy the current Phase A branch to Preview.
5. Run Preview smoke tests with Basic Auth still active.
6. Run real database-backed E2E tests.
7. Review E2E and smoke results.
8. Implement Basic Auth removal on a new local commit.
9. Run the full automated suite.
10. Obtain independent Claude/Fable code and security review.
11. Deploy the removal commit to Preview.
12. Run post-removal Preview smoke tests:
    - public `/dashboard/login`
    - public dashboard auth APIs
    - protected routes deny without session
    - valid session renders `/overview` and `/dashboard`
    - logout revokes and denies afterward
13. Obtain explicit production approval.
14. Verify production secrets and users by presence/status only.
15. Create rollback checkpoint or tag.
16. Deploy production.
17. Run production smoke tests:
    - login/setup or login/TOTP
    - `/overview`
    - `/dashboard`
    - one additional protected route
    - logout
    - post-logout denial
18. Monitor and document rollback criteria for the agreed window.

## J. Rollback Plan

- Rollback checkpoint: tag or record the last known Phase A deployment/commit before Basic Auth removal.
- Fast restore: redeploy the Phase A commit or revert the Basic Auth removal commit.
- Keep `DASHBOARD_SECRET` configured until the rollback window closes.
- Do not roll back the database schema; Phase B should not require schema changes.
- To invalidate app-owned sessions, update active `dashboard_sessions` rows to set `revoked_at = now()` through an approved service-role operator path.
- To disable a compromised user, set `dashboard_users.status = 'disabled'` and revoke that user's sessions.
- Rollback triggers:
  - Admins cannot log in.
  - Protected pages become public.
  - OTP email delivery fails broadly.
  - Session revocation/logout fails.
  - Production DB auth queries fail in a way that blocks operations beyond the accepted window.
  - Sensitive values appear in logs.
- After rollback, confirm Basic Auth 401/200 behavior and protected dashboard access.

## K. Test Plan

### Existing Automated Suites

- `npx vitest run`
- `npx playwright test tests/dashboard-auth.spec.ts --project=desktop`
- `npm run lint`
- `npm run build`
- `git diff --check`

### Phase A Regression Tests

- Existing auth API route tests.
- Existing `lib/dashboardAuth` tests.
- Existing route guard coverage tests.
- Existing logout route/UI tests.
- Existing dashboard-auth Playwright suite.

### Real DB-Backed E2E

Mandatory before Basic Auth removal:

- Login with the seeded Preview user.
- Confirm `/overview` loads.
- Confirm `/dashboard` renders the Email Tracker business UI.
- Confirm another protected route loads.
- Revoke or expire the DB session.
- Soft-navigate to another protected sibling route.
- Confirm denial to `/dashboard/login`.
- Logout revokes and clears cookie.
- Post-logout protected access is denied.

### Basic Auth Removal Tests

- `/dashboard/login` no longer requires Basic Auth.
- Dashboard auth APIs no longer require Basic Auth.
- Protected pages still deny without dashboard session.
- Basic Auth headers no longer determine dashboard access.
- `DASHBOARD_SECRET` absence no longer blocks `/dashboard` after its page check is removed.
- No route becomes public by mistake.

### Public Login/API Tests

- Missing/malformed JSON still returns generic `{ ok: false }`.
- Unknown/disabled/throttled users remain enumeration-safe.
- OTP/TOTP failures remain generic.
- Session token is never returned in JSON.
- Challenge, OTP, TOTP code, provisioning URI, and session token are not logged.

### Protected Route Tests

- No cookie.
- Fake cookie.
- Malformed cookie.
- Expired session.
- Revoked session.
- Disabled user.
- Missing user.
- Database failure.
- Valid session.
- All protected route categories, including `/applications`, `/mailboxes`, and `/ca-portfolio`.

### Logout Tests

- Valid cookie revokes.
- No cookie succeeds.
- Malformed cookie succeeds.
- Already-revoked session succeeds.
- Double logout succeeds.
- Cookie clears.
- Post-logout access denied.
- Origin mismatch returns generic `{ ok: false }`.

### Secret-Missing and DB-Failure Tests

- Missing session/TOTP/challenge/Microsoft env vars fail closed where applicable.
- Missing `DASHBOARD_SECRET` should not matter after Basic Auth removal and `/dashboard` check removal.
- DB failures deny protected pages and produce generic login failures.

### Smoke Tests

Preview smoke before removal:

- Basic Auth remains active.
- Dashboard login flow works behind Basic Auth.
- Auth API calls work same-origin behind Basic Auth.
- Dashboard session protects pages beneath Basic Auth.

Preview smoke after removal:

- Login route public.
- Auth APIs public.
- Protected pages deny without session.
- Valid session can access `/overview`, `/dashboard`, and one additional protected route.
- Logout denies later access.

Production smoke after explicit approval:

- Same as post-removal Preview smoke, using approved production `admin_ceo` user.

## L. Explicit Out of Scope

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
- Production deployment during this planning task.
- Production user seeding during this planning task.
- Removing or changing session hashing/encryption primitives.

## M. Owner Decisions Required Before Implementation

The owner must explicitly decide:

1. Which Preview deployment URL and Supabase project are the authorized Phase B test targets.
2. Which non-production `admin_ceo` test email will be seeded in Preview.
3. Whether to create a one-off seed script or use reviewed SQL for Preview seeding.
4. Whether the seed process may reset `totp_enabled` and `totp_secret_encrypted` for duplicate Preview test users.
5. Whether CI or local operator execution will run the real DB-backed E2E tests.
6. Whether the E2E test may use a local service-role utility to revoke/expire Preview sessions.
7. Who owns the Microsoft OTP mailbox access during Preview tests.
8. Whether seeded Preview users should be disabled or left active after testing.
9. Whether audit rows for Preview auth testing should be retained or cleaned.
10. The production `admin_ceo` bootstrap email and whether it differs from the Preview test user.
11. How long `DASHBOARD_SECRET` remains configured after Phase B production deployment for rollback.
12. The exact rollback checkpoint/tag name before production deployment.
13. Who gives final approval for Basic Auth removal implementation.
14. Who gives final approval for production deployment.

## Implementation Task Outline

### Task 1: Preview Seed and E2E Harness Plan Finalization

**Files likely changed:**
- Create or modify an approved operator script only after owner chooses the seeding strategy.
- Create a dedicated real DB-backed E2E test file only after Preview target and user are approved.
- Update docs/state/log.

**Deliverable:** Preview seeded-user test path proves real session creation, revocation/expiry, soft-navigation denial, `/overview`, `/dashboard`, logout, and cleanup.

### Task 2: Basic Auth Removal Implementation

**Files likely changed:**
- `middleware.ts`
- `app/api/dashboard/auth/*/route.ts`
- `app/api/dashboard/auth/_lib/basicAuthGate.ts`
- `app/api/dashboard/auth/_lib/basicAuthGate.test.tsx`
- `app/dashboard/page.tsx`
- `tests/dashboard-auth.spec.ts`
- related route tests
- `.env.example`
- docs/state/log

**Deliverable:** Login/auth APIs are public, protected pages remain session-guarded, `/dashboard` keeps its business UI, and all tests pass.

### Task 3: Preview Post-Removal Verification

**Files likely changed:**
- Tests/docs only unless a defect is found.

**Deliverable:** Preview confirms Basic Auth is removed and dashboard sessions independently protect all approved routes.

### Task 4: Production Rollout Checkpoint

**Files likely changed:**
- State/run-log only unless owner approves release notes.

**Deliverable:** Owner has reviewed Preview evidence, production prerequisites, rollback checkpoint, and smoke-test checklist before any production deploy.

## Self-Review Checklist

- This plan does not implement Phase B.
- This plan does not remove Basic Auth.
- This plan does not seed users.
- This plan does not change env vars.
- This plan does not deploy.
- It names all known Basic Auth removal touchpoints.
- It keeps `requireDashboardSession()` as the page-level security boundary.
- It requires real database-backed Preview E2E before Basic Auth removal.
- It preserves `/overview` landing and `/dashboard` business UI behavior.
