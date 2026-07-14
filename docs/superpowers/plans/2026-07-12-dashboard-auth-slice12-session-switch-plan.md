# Dashboard Auth Phase 1 Slice 12 Plan: Session Switch Under Basic Auth

Status: revised plan only. Do not implement without Claude/Fable APPROVED review and explicit owner approval.

## Review Status

Previous planning commit:

- `c59734dfc562e7c083af3ace579840afe39f23c1`

Independent review verdict:

- `CHANGES REQUIRED`

This revision incorporates owner decisions and architectural corrections only. No production code is approved by this document.

## Confirmed Owner Decisions

- Include logout in Slice 12.
- Do not create a separate access-denied page.
- Keep Basic Auth during Phase A.
- `/dashboard` remains a protected standalone Email Tracker business page.
- `/overview` remains the authenticated post-login and post-setup landing page because repository evidence confirms it is the primary COO operations workspace.
- Role-based authorization is deferred. Slice 12 validates session usability only.
- Protect additional operations-shell routes now:
  - `/applications`
  - `/applications/[applicationId]`
  - `/mailboxes`
  - `/ca-portfolio`
- Use authoritative per-page server guards.
- Never rely on `app/(operations)/layout.tsx` as the sole authentication boundary.
- Do not import `getDashboardSessionByToken()` directly into middleware.
- Do not modify `sessionStore.ts` merely to make it middleware-compatible.
- No implementation is approved until this revised plan receives an APPROVED review.

## Goal

Slice 12 Phase A adds the dashboard-session authorization layer underneath the still-active Basic Auth layer.

Users still pass Basic Auth first. After that, every protected business page must independently validate the `dashboard_session` cookie server-side with the reviewed session-store helper before rendering protected content.

Successful login/setup continues to land on `/overview`. `/dashboard` remains protected, but it remains the standalone Supabase-backed Email Tracker business interface, not the post-login landing page.

## Two-Phase Basic Auth Transition

### Phase A: Slice 12

Phase A is the only scope proposed for Slice 12.

- Keep existing Basic Auth middleware behavior unchanged.
- Keep Basic Auth over `/dashboard/login`.
- Keep Basic Auth over the dashboard authentication API routes.
- Add the new dashboard-session authorization layer underneath Basic Auth.
- Confirm browsers and Playwright `httpCredentials` can use `/dashboard/login` and same-origin authentication API calls while Basic Auth remains active.
- Keep `DASHBOARD_SECRET` configured.
- Do not remove the existing `DASHBOARD_SECRET` configuration check from `app/dashboard/page.tsx`.
- Include logout as a Phase A route and UI action, still behind Basic Auth.
- Do not push or deploy as part of plan approval or implementation.

During Phase A, Basic Auth remains the outer operational gate and the new dashboard session guard becomes the inner application-auth gate.

### Phase B: Separate Review and Approval

Phase B is not part of Slice 12.

Only after preview/staging verification and production `dashboard_users` seeding:

- Remove Basic Auth from middleware.
- Remove route-level Basic Auth gates from dashboard auth API routes.
- Review and remove or replace the `DASHBOARD_SECRET` configuration check inside `app/dashboard/page.tsx`.
- Verify the new session authentication system independently protects all intended routes.
- Run production-like smoke tests with a real seeded `admin_ceo` dashboard user.
- Obtain explicit approval before production rollout.

Basic Auth removal is explicitly out of scope for Slice 12 Phase A.

## Current-State Analysis

### Current Middleware

- `middleware.ts` currently enforces Basic Auth only.
- Current middleware protects `/dashboard`, `/overview`, `/live-monitor`, `/clients`, `/operations`, and `/review-queue`.
- Because `/dashboard/:path*` is matched, `/dashboard/login` is currently also behind Basic Auth.
- Slice 12 Phase A keeps this behavior unchanged.
- The project currently emits a Next.js 16.2.9 middleware deprecation warning. A future `proxy.ts` migration may be considered, but that migration is not required to establish the Slice 12 security boundary. Do not expand Slice 12 merely to eliminate the warning unless implementation proves it is necessary.

### Current Dashboard Route

- `/dashboard` is restored to the pre-Slice-11 Email Tracker Dashboard from `fdd1caf`.
- It queries Supabase and renders recent Zoho email/classification data.
- It contains a `DASHBOARD_SECRET` configuration check inherited from the Basic Auth era.
- Phase A must not remove that check.

### Current Login Route

- `/dashboard/login` is a server component that reads `dashboard_session`.
- It calls `getDashboardSessionByToken(rawToken)`.
- It redirects to `/overview` only when the helper returns a usable session.
- Missing, fake, expired, revoked, disabled-user, malformed, or DB-failure session cases render the login flow.
- In Phase A, this route remains behind Basic Auth and also remains public to the new dashboard-session layer.

### Current `/overview` Protection Status

- `/overview` is the primary COO operations workspace.
- The Slice 11 login UI redirects to `/overview` after successful setup/login.
- The operations layout and current tests treat `/overview` as the authenticated landing page.
- Today it is protected only by Basic Auth. Phase A adds a per-page dashboard-session guard.

### Current Session Cookie and Validation Path

- Slice 10 auth routes set `dashboard_session` after successful TOTP setup or returning-user TOTP login.
- Cookie attributes are `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=43200`, and `Secure` in production.
- Route handlers do not return raw session tokens in JSON.
- `getDashboardSessionByToken` hashes the raw token, reads `dashboard_sessions`, reads `dashboard_users`, rejects revoked/expired sessions and disabled users, and best-effort updates `last_seen_at`.

### Current Logout and Revocation

- `revokeDashboardSession` and `revokeDashboardSessionsForUser` exist in `lib/dashboardAuth/sessionStore.ts`.
- No logout route or UI exists yet.
- Slice 12 Phase A must add logout.

### Existing Auth APIs

- Existing app routes are:
  - `POST /api/dashboard/auth/request-otp`
  - `POST /api/dashboard/auth/verify-otp`
  - `POST /api/dashboard/auth/complete-totp-setup`
  - `POST /api/dashboard/auth/verify-totp`
- These routes currently include route-level Basic Auth.
- Phase A keeps those Basic Auth gates.
- Same-origin browser requests from `/dashboard/login` can call these APIs after the user has passed Basic Auth because the browser includes Basic Auth credentials for the protected origin. Playwright should continue using `httpCredentials` for Phase A flow tests.

### Legacy Mechanism

- Basic Auth with username `admin` and `DASHBOARD_SECRET` is the current live authentication mechanism.
- Phase A adds app-owned authentication beneath it.
- Phase B replaces Basic Auth only after separate approval.

## Final Landing Route

- Successful login redirects to `/overview`.
- Successful first-time TOTP setup redirects to `/overview`.
- A valid authenticated session visiting `/dashboard/login` redirects to `/overview`.
- `/overview` is the primary authenticated COO operations landing page.
- `/dashboard` remains protected but is not the post-login landing page.
- `/dashboard` continues to display the standalone Supabase-backed Email Tracker business interface.

Current implementation/test touchpoints using `/overview`:

- `components/dashboard-auth/dashboard-auth-client.tsx` redirects to `/overview` after successful setup/login.
- `app/dashboard/login/page.tsx` redirects a valid existing session to `/overview`.
- `tests/dashboard-auth.spec.ts` verifies successful setup/login navigation to `/overview`.
- `app/(operations)/layout.tsx` identifies `/overview` as the Overview navigation route.
- `app/page.tsx` includes an "Open COO Overview" link to `/overview`.

## Final Route Policy

### Authoritative Protected Route Set

The dashboard-session layer must protect:

- `/dashboard`
- `/overview`
- `/live-monitor`
- `/live-monitor/:path*`
- `/clients/:path*`
- `/operations/:path*`
- `/review-queue`
- `/applications`
- `/applications/:path*`
- `/mailboxes`
- `/ca-portfolio`

The mock-data operations routes are protected now to prevent accidental exposure when they later receive live data.

### Public to the Dashboard-Session Layer

These routes are public to the new dashboard-session authorization layer:

- `/`
- `/dashboard/login`
- `/api/dashboard/auth/*`
- `/_next/*`
- Static assets and metadata

During Phase A, `/dashboard/login` and `/api/dashboard/auth/*` still remain behind the existing Basic Auth layer even though they are public to the dashboard-session authorization layer.

Other Zoho, cron, worker, test, and unrelated APIs must remain untouched unless currently covered by Basic Auth.

## Authoritative Guard Architecture

Create a new server-only helper, for example:

```ts
requireDashboardSession()
```

It should:

1. Read `dashboard_session` using `next/headers`.
2. Call the already-reviewed `getDashboardSessionByToken()`.
3. Return the valid session when `ok: true`.
4. Redirect to `/dashboard/login` for every other result.
5. Fail closed on exceptions.
6. Never expose or log the raw session token.

Call this helper at the top of every protected server page.

For protected client-component pages:

- Move the existing client implementation into a dedicated client component if necessary.
- Keep `page.tsx` as a thin server wrapper.
- Call `requireDashboardSession()` in the server wrapper before rendering the client component.

Explicit constraints:

- Never rely on `app/(operations)/layout.tsx` as the sole authorization guard.
- Layout caching and soft navigation make a layout-only guard insufficient.
- Every protected page must enforce authorization independently on the server.
- Do not import `getDashboardSessionByToken()` into middleware.
- Do not alter `sessionStore.ts` or remove `server-only` to force middleware bundling.
- Do not duplicate session hashing, expiry, revocation, user-status, or DB logic in pages.

## Middleware Role in Phase A

Middleware remains limited to:

- Existing Basic Auth.
- Optional cookie-presence redirect as a user-experience optimization only.

If cookie-presence routing is included:

- Cookie presence is not authentication.
- Authoritative authentication remains the per-page server guard.
- A fake, expired, revoked, disabled, malformed, or database-failure session must still be denied by the page guard.

Do not import server-only dashboard auth helpers into middleware.

## Role Scope

Do not add an access-denied page in Slice 12.

Do not add role-placeholder routing in Slice 12.

Phase 1 production users are seeded as `admin_ceo`.

Slice 12 validates only whether the user and session are usable. Role-specific authorization and role-specific pages are deferred to a later independently planned slice.

## Logout Architecture

Slice 12 must include:

- `POST /api/dashboard/auth/logout`

Required behavior:

1. During Phase A, call `requireDashboardBasicAuth()` first, consistent with sibling auth routes.
2. Apply a same-origin `Origin` or `Sec-Fetch-Site` check if compatible with the project's existing API conventions.
3. Read `dashboard_session` server-side.
4. When present, call `revokeDashboardSession(rawToken)`.
5. Do not expose whether the token existed or revocation succeeded.
6. Always clear the cookie.
7. Always return `200 { "ok": true }`.
8. Work for missing, malformed, expired, already-revoked, or otherwise invalid cookies.
9. Never log the session token.
10. Do not require a request body.

Cookie clearing must use the same:

- Cookie name
- Path
- `httpOnly`
- `sameSite`
- `secure`

and set `maxAge: 0` or equivalent expiration.

Add a minimal logout UI action in the operations navigation:

- POST to the logout endpoint.
- Hard-navigate to `/dashboard/login` after completion.
- Avoid depending on a soft router transition for clearing authenticated client state.

## Security Analysis

### Fail-Open vs Fail-Closed

- Session validation must fail closed on missing token, malformed token, DB error, missing session, expired session, revoked session, disabled user, or missing user.
- Login APIs should preserve generic failure shapes and account-enumeration safety.
- Phase A still has Basic Auth as an outer gate, but the dashboard-session layer must be correct independently.

### Database Outage

- Protected pages should redirect to `/dashboard/login` or deny access on DB failure.
- Do not allow protected content because validation cannot be completed.
- User-facing behavior should remain generic.

### Cookie Replay and Token Hashing

- Raw session tokens live only in the HttpOnly cookie and route/server memory.
- DB stores `session_hash`, not raw tokens.
- Replay remains possible until expiry/revocation if an HttpOnly cookie is stolen; keep `Secure`, `SameSite=Lax`, 12-hour lifetime, and revocation support.

### Secret Rotation

- `DASHBOARD_SESSION_SECRET` rotation invalidates existing session hashes unless a dual-secret migration is designed.
- `DASHBOARD_TOTP_ENCRYPTION_KEY` rotation requires a re-encryption or re-enrollment plan.
- `DASHBOARD_LOGIN_CHALLENGE_SECRET` rotation invalidates in-flight login challenges only.
- Do not rotate secrets in Slice 12.

### Session Expiry, Revocation, and User Disabling

- Use `getDashboardSessionByToken` through `requireDashboardSession()` so expiry, revoked_at, missing user, and disabled-user checks stay centralized.
- Logout should call reviewed revocation helpers.
- A disabled `dashboard_users` row must invalidate access on next validation.

### Bypass Risks

- Every protected page must call the server guard.
- The operations layout must not be the sole guard.
- Soft navigation must not allow stale layout state to bypass page authorization.
- Auth APIs and static assets should be intentionally excluded from the dashboard-session layer.

### Open Redirect Risk

- Do not add arbitrary `next` or `returnTo` behavior in Slice 12.
- If later needed, allow only same-origin relative paths from an allowlist.

### Sensitive Logging

Never log:

- raw session token,
- session hash,
- Basic Auth credentials,
- OTP,
- TOTP code,
- challenge,
- TOTP secret,
- Microsoft access token,
- DB error bodies containing sensitive data.

## Required Tests

### Guard Tests

For every protected route category, cover:

- No cookie
- Fake cookie
- Malformed cookie
- Expired session
- Revoked session
- Disabled user
- Missing user
- Database failure
- Valid session

Use representative parameterized tests where practical, but every newly protected route must be covered.

Protected route categories include:

- `/dashboard`
- `/overview`
- `/live-monitor`
- `/clients`
- `/operations`
- `/review-queue`
- `/applications`
- `/applications/[applicationId]`
- `/mailboxes`
- `/ca-portfolio`

### Route-Policy Tests

- `/dashboard/login` remains accessible under Phase A Basic Auth credentials.
- Valid session visiting `/dashboard/login` redirects to `/overview`.
- Invalid session visiting a protected page redirects to `/dashboard/login`.
- `/dashboard` renders the original Email Tracker Dashboard after valid authentication.
- `/overview` renders as the authenticated landing page.
- `/applications` is protected.
- `/applications/[applicationId]` is protected.
- `/mailboxes` is protected.
- `/ca-portfolio` is protected.

### Layout Bypass and Soft-Navigation Test

Add a test that:

1. Starts with a valid authenticated session.
2. Loads a protected route.
3. Revokes or expires the session server-side.
4. Attempts client-side navigation to another protected sibling route.
5. Confirms access is denied.

This proves no layout-cache or soft-navigation bypass exists.

### Logout Tests

- Logout with valid cookie.
- Logout with no cookie.
- Logout with malformed cookie.
- Logout with already-revoked session.
- Double logout returns success both times.
- Cookie is cleared.
- Session is revoked when valid.
- No token or revocation state is leaked.
- Protected route access is denied after logout.
- Same-origin protection behavior, if added.

### Phase A Coexistence Tests

- Basic Auth remains required.
- Dashboard login flow works while Basic Auth is active.
- Same-origin authentication API requests work with Basic Auth credentials.
- Dashboard session protection functions underneath Basic Auth.

### Deferred Test Requirement

A real database-backed valid-session E2E test using isolated seeded preview/test data is mandatory before Phase B Basic Auth removal, but it does not block the Phase A implementation commit if the test environment is not safely available.

### Regression Verification

- Existing Slice 10 auth API tests still pass.
- Existing Slice 11 frontend tests still pass.
- `npx vitest run`, `npm run lint`, and `npm run build` must pass for implementation.

## Production Prerequisites

Production deployment is not part of the current approval.

Before production rollout:

- `DASHBOARD_SESSION_SECRET`
- `DASHBOARD_TOTP_ENCRYPTION_KEY`
- `DASHBOARD_LOGIN_CHALLENGE_SECRET`
- Microsoft Graph OTP env vars:
  - `MICROSOFT_TENANT_ID`
  - `MICROSOFT_CLIENT_ID`
  - `MICROSOFT_CLIENT_SECRET`
  - `MICROSOFT_OTP_FROM_EMAIL`
- `DASHBOARD_SECRET` retained through Phase A
- Four authentication tables verified:
  - `dashboard_users`
  - `dashboard_email_otps`
  - `dashboard_sessions`
  - `dashboard_auth_audit_events`
- At least one active `admin_ceo` dashboard user seeded
- Safe bootstrap/operator procedure
- Presence-only secret verification
- Preview/staging smoke test
- Backup branch or release tag
- Rollback to the last Basic Auth deployment
- Session revocation/recovery procedure

Never print secret values while verifying prerequisites.

## Rollout and Rollback

### Phase A Rollout

1. Keep current production unchanged until implementation is reviewed.
2. Verify required env var presence without printing values.
3. Seed at least one active `admin_ceo` dashboard user in the target environment through an approved operator process.
4. Deploy to Preview/staging only after explicit approval.
5. Smoke test Basic Auth plus dashboard-session behavior together.
6. Obtain approval before any production deploy.

### Phase B Rollout

Phase B requires a new plan and review before Basic Auth removal.

### Rollback

- Revert the Slice 12 implementation commit or redeploy the last known Basic Auth deployment.
- Do not delete auth tables or seeded users during rollback.
- Keep `DASHBOARD_SECRET` available through Phase A.
- Logout route rollback should not require schema changes.

## Explicit Out of Scope

Do not include in Slice 12 Phase A:

- Basic Auth removal
- Route-level Basic Auth gate removal
- `DASHBOARD_SECRET` removal
- `DASHBOARD_SECRET` check removal from `app/dashboard/page.tsx`
- role-based authorization
- access-denied page
- role-placeholder pages
- Leads API data scoping
- Manager/CA scoped dashboards
- New dashboard metrics
- Human Review changes
- Live Monitor changes
- worker/sync/backfill/release changes
- database migrations
- package installation
- secret rotation
- production env changes
- deployment or push
- UI redesign of `/dashboard`
- mobile app
- password login

## Execution Gates

1. Claude/Fable re-review of this revised plan.
2. Explicit owner approval before implementation.
3. Codex GPT-5.5 High implementation.
4. Full automated verification.
5. Claude/Fable independent code review.
6. Explicit approval before push.
7. Explicit approval before deploy.

## Remaining Decisions Before Implementation

- Confirm same-origin protection shape for logout: `Origin`, `Sec-Fetch-Site`, or both.
- Confirm safe seeded test strategy for real DB-backed valid-session E2E before Phase B.
