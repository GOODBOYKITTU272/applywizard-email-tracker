# ApplyWizz Dashboard Authentication + Role-Based Access Design

**Status:** Approved design/spec only. No implementation code, app code changes, Codex handoff, push, or deploy in this step.
**Date:** 2026-07-09

## A. Recommended auth architecture

Replace dashboard Basic Auth with app-owned authentication backed by Supabase/Postgres.

The first version uses:

- `dashboard_users` as the final staff allowlist.
- Primary allowed email domain: `@applywizz.ai`.
- Explicit allowlisted users for valid staff emails that may use `@applywizard.ai` or another approved company email later.
- Email OTP for first-time verification and enrollment.
- Authenticator/TOTP enrollment after OTP verification.
- Future login with email + Authenticator code.
- Server-side opaque session cookie.
- Server-side route and role checks.

Do not rely only on a domain check. The domain check is an early rejection rule; the `dashboard_users` table is the real allowlist and role source.

Do not use password login. Do not call the Leads API in Phase 1. Do not trust frontend filtering for authorization.

## B. Phase 1 scope

Phase 1 builds only the secure login foundation:

- `@applywizz.ai` domain support.
- Explicit staff allowlist through `dashboard_users`.
- Email OTP verification for first-time setup.
- Authenticator/TOTP enrollment.
- Authenticator/TOTP login.
- User role storage.
- Server-side session creation and validation.
- Replacement for Basic Auth route protection.
- Role-aware route guard foundation.
- OTP and TOTP rate limits.
- Audit trail for login attempts and future role changes.

Safe Phase 1 access default:

- Admin / CEO can access broad dashboards.
- Manager Ops can log in but sees access denied or a limited placeholder until scoped access exists.
- CA can log in but sees access denied or a limited placeholder until scoped access exists.

## C. Phase 2 scope

Phase 2 adds real data scoping after the auth foundation is live.

Use the Leads API or an internal mapping table to map:

```text
client email / tracker mailbox
-> client name
-> assigned CA
-> manager/team
```

Then dashboard access becomes:

- Admin / CEO: all records.
- Manager Ops: records for assigned CA team only.
- CA: records for assigned clients only.

Data scoping must happen in server-side query helpers and route handlers, not only in UI components.

## D. Tables needed

### `dashboard_users`

- `id`
- `email`
- `role`
- `status`
- `totp_enabled`
- `totp_secret_encrypted`
- `created_at`
- `updated_at`
- `last_login_at`

Suggested roles:

- `admin_ceo`
- `manager_ops`
- `ca`

Suggested statuses:

- `active`
- `disabled`

### `dashboard_email_otps`

- `id`
- `user_id`
- `otp_hash`
- `expires_at`
- `used_at`
- `attempt_count`
- `created_at`

OTP values must never be stored raw.

### `dashboard_sessions`

- `id`
- `user_id`
- `session_hash`
- `expires_at`
- `revoked_at`
- `created_at`
- `last_seen_at`

Session tokens must be stored hashed.

### `dashboard_auth_audit_events`

- `id`
- `user_id`
- `email`
- `event_type`
- `success`
- `ip_hash`
- `user_agent_hash`
- `created_at`

Use this for login attempts, OTP requests, OTP verification, TOTP verification, logout, session revocation, and future role changes.

### Later Phase 2 scope tables

Add only when building scoped data access:

- `dashboard_manager_ca_scope`, or
- `dashboard_user_ca_scope`, or
- a normalized internal client/CA/manager mapping table.

Do not add these in Phase 1 unless the scoped access build starts.

## E. Routes/screens needed

Phase 1 routes/screens:

- `/login`
- `/login/verify-email`
- `/login/setup-authenticator`
- `/login/authenticator`
- `/logout`
- `/access-denied`

Later admin routes:

- `/admin/users`
- `/admin/users/[id]`
- role management audit view

Do not build new dashboards as part of auth Phase 1.

## F. Role access matrix

### Phase 1 safe access

| Area | Admin / CEO | Manager Ops | CA |
|---|---:|---:|---:|
| Login | Yes | Yes | Yes |
| Existing broad dashboards | Yes | No | No |
| Human Review | Yes | No until scoped | No until scoped |
| Safe Email Preview | Yes | No until scoped | No until scoped |
| Live Monitor | Yes | No until scoped | No until scoped |
| User and role management | Later | No | No |

### Phase 2 scoped access

| Data | Admin / CEO | Manager Ops | CA |
|---|---:|---:|---:|
| All clients | Yes | No | No |
| Managed CA team clients | Yes | Yes | No |
| Own assigned clients | Yes | Yes if team member | Yes |
| All-company totals | Yes | Explicit allow only | No by default |
| Role changes | Admin only | No | No |

## G. Security risks and controls

Risk: a CA edits a URL and accesses another CA's records.
Control: all record access must be scoped in server-side data queries.

Risk: a manager sees another manager's team.
Control: manager-to-CA scope must be enforced server-side before returning rows.

Risk: OTP brute force.
Control: hash OTPs, expire them, enforce attempt limits, and rate-limit OTP requests and verification attempts.

Risk: TOTP brute force.
Control: rate-limit TOTP attempts and audit failures.

Risk: TOTP secret leakage.
Control: encrypt TOTP secrets with a server-only key stored outside code.

Risk: session theft.
Control: use HttpOnly, Secure, SameSite cookies with a 12-hour expiry and hashed session tokens server-side.

Risk: migration accidentally exposes dashboards.
Control: keep broad dashboards Admin-only until scoped authorization exists; verify unauthenticated and non-admin denial before removing Basic Auth.

Risk: role assigned incorrectly.
Control: audit role changes and keep user management admin-only.

## H. Migration plan from Basic Auth

1. Build auth tables and helpers while Basic Auth still protects existing dashboard routes.
2. Seed or bootstrap the first Admin / CEO through an env-configured email.
3. Add login and enrollment routes.
4. Add session cookie guard.
5. Add role guard that allows only Admin / CEO into broad dashboards.
6. Test unauthenticated, Manager Ops, CA, and Admin / CEO access.
7. Deploy with Basic Auth still available as the outer safety layer if needed.
8. Smoke test real login in Preview.
9. Smoke test real login in Production.
10. Remove Basic Auth only after confirmed successful production login and route protection.

## I. Rollback plan

Keep a short rollback path until production login is proven:

- Preserve the last working Basic Auth commit/deployment.
- Keep the existing `DASHBOARD_SECRET` available until real auth is stable.
- If real login blocks admins, redeploy the previous Basic Auth deployment or re-enable the Basic Auth guard.
- Do not delete Basic Auth env configuration until after production smoke tests pass.
- Do not make Manager Ops or CA access broad dashboards during rollback.

## J. Environment variables needed later

Document these later with placeholders only:

- `DASHBOARD_BOOTSTRAP_ADMIN_EMAIL`
- `DASHBOARD_SESSION_SECRET`
- `DASHBOARD_TOTP_ENCRYPTION_KEY`
- `MICROSOFT_TENANT_ID`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_OTP_FROM_EMAIL`

Do not include real values in code, specs, tests, logs, commits, or deployment output.

OTP email provider decision:

- Use Microsoft Graph API for staff dashboard OTP email.
- Use only the `MICROSOFT_*` environment variable names listed above.
- Do not use `MS_GRAPH_*` names.
- These values are configured as Sensitive env vars in Vercel for Production and Preview.
- Do not expose these env vars to frontend code.
- Do not use Zoho client mailboxes for dashboard authentication.
- Do not print Microsoft access tokens.
- Do not print raw Microsoft Graph errors.
- Do not implement the provider in this spec step.
- No redeploy was needed when these env vars were added because auth code is not implemented yet.

## K. Open questions remaining

1. Which Microsoft Graph permissions and tenant admin consent process should be used for OTP email sending?
2. What is the final session inactivity policy after the initial 12-hour expiry ships?
3. Who can create or disable Manager Ops and CA users before a full admin user-management screen exists?
4. Should `@applywizard.ai` be allowed broadly, or only through explicit `dashboard_users` rows?
5. What production process rotates `DASHBOARD_TOTP_ENCRYPTION_KEY` if needed?

## L. Smallest safe Codex implementation plan for later

Do not execute this plan yet.

1. Add auth database migration for users, OTPs, sessions, audit events, and minimal constraints.
2. Add server-only auth helpers for allowlist lookup, OTP hashing/verification, TOTP secret encryption, TOTP verification, session creation, session lookup, and logout.
3. Add OTP email adapter interface with a Microsoft Graph implementation behind the documented `MICROSOFT_*` env vars.
4. Add login, OTP verification, TOTP enrollment, TOTP login, logout, and access-denied screens.
5. Replace Basic Auth middleware protection with session-based protection after staged smoke testing.
6. Make existing broad dashboard routes Admin / CEO only.
7. Add focused tests for domain rejection, allowlist rejection, OTP expiry, OTP reuse, TOTP failure, session expiry, unauthenticated redirect, and non-admin denial.
8. Deploy to Preview and verify.
9. Deploy to Production and verify.
10. Remove Basic Auth only after production auth smoke passes.

## M. What not to build in Phase 1

Do not build:

- Leads API integration.
- Manager productivity dashboard.
- CA dashboard.
- 25 jobs proof.
- Classification counts by role.
- Hy3.
- DeepSeek.
- OpenRouter.
- New dashboards.
- Mobile app.
- Password login.
- Client-side-only authorization.
- Full user-management UI unless explicitly approved later.

Phase 1 authenticates staff and protects routes. Phase 2 scopes the data.
