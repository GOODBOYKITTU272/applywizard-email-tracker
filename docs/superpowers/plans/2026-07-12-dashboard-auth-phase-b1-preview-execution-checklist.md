# Dashboard Auth Phase B1 Preview Execution Checklist

Status: operator checklist only. Do not use this as evidence that Preview execution has happened.

Approved tooling:
- Phase B1 tooling fix commit: `66d0c855e3d8efe4beaa6b2487c573c19f654b39`
- Tooling is approved for Preview-only execution after all gates below are satisfied.
- Production execution remains prohibited.

Global rules:
- Never print secret values.
- Never paste secrets into logs, screenshots, Git, issues, review prompts, or chat.
- Do not seed Production.
- Do not use Production service-role credentials.
- Do not proceed to Phase B Basic Auth removal from this checklist.
- Stop immediately on any abort condition.

## Gate 1 - Dedicated Preview Supabase

- [ ] Create a separate Supabase project for Preview.
- [ ] Record the Preview project ref in an operator-only secure note.
- [ ] Record the Production project ref separately in an operator-only secure note.
- [ ] Confirm both refs match the Supabase project-reference format.
- [ ] Confirm the Preview and Production refs are different.
- [ ] Apply only the required dashboard-auth migration to the Preview project.
- [ ] Verify these four authentication tables exist in Preview:
  - `dashboard_users`
  - `dashboard_email_otps`
  - `dashboard_sessions`
  - `dashboard_auth_audit_events`
- [ ] Confirm no Production service-role key is copied into Preview configuration.
- [ ] Confirm no Production data was copied into the Preview auth tables.

## Gate 2 - Preview Environment

Set these only in the Vercel Preview scope:

- [ ] `DASHBOARD_AUTH_E2E_TARGET=preview`
- [ ] `DASHBOARD_AUTH_SEED_TARGET=preview`
- [ ] `DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF`
- [ ] `DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF`
- [ ] Preview `NEXT_PUBLIC_SUPABASE_URL`
- [ ] Preview Supabase service-role key
- [ ] `DASHBOARD_SESSION_SECRET`
- [ ] `DASHBOARD_TOTP_ENCRYPTION_KEY`
- [ ] `DASHBOARD_LOGIN_CHALLENGE_SECRET`
- [ ] Existing Basic Auth variables required during Phase A, including `DASHBOARD_SECRET`
- [ ] Required Microsoft Graph variables for OTP sending, where applicable:
  - `MICROSOFT_TENANT_ID`
  - `MICROSOFT_CLIENT_ID`
  - `MICROSOFT_CLIENT_SECRET`
  - `MICROSOFT_OTP_FROM_EMAIL`

Verification:
- [ ] Verify presence only.
- [ ] Never print values.
- [ ] Never paste values into terminal logs, screenshots, Git, issues, review prompts, or chat.
- [ ] Confirm the resolved Supabase URL matches the Preview project ref.
- [ ] Confirm the resolved Supabase URL does not match the Production project ref.

## Gate 3 - Test Mailbox

- [ ] Create or confirm `dashboard-auth-test@applywizz.ai`.
- [ ] Verify it can receive dashboard OTP email.
- [ ] Verify Microsoft Graph access is limited appropriately for OTP sending.
- [ ] Do not use a real executive/admin mailbox.
- [ ] Confirm no OTP, TOTP seed, recovery code, password, token, or cookie appears in logs or screenshots.

## Gate 4 - Checkpoint Push and Preview Deployment

- [ ] Obtain explicit owner approval to push `worker-preflight`.
- [ ] Push `worker-preflight` only.
- [ ] Deploy only to a Vercel Preview environment.
- [ ] Record the exact Git commit used for the Preview deployment.
- [ ] Record the exact Preview URL.
- [ ] Confirm the Preview hostname is not the Production alias.
- [ ] Confirm Basic Auth is active on the Preview deployment.
- [ ] Confirm Production remains untouched.

## Gate 5 - Controlled Execution Order

Run in this exact order:

1. Run the no-environment CLI smoke and confirm safe refusal.
2. Run the Preview CLI with `--dry-run`.
3. Inspect sanitized output only.
4. Perform the real Preview admin seed.
5. Verify the intended Preview user only.
6. Run the operator-assisted real Preview DB-backed E2E.
7. Capture sanitized PASS/FAIL evidence only.
8. Run mandatory cleanup.
9. Verify the test user's active sessions were revoked.
10. Stop. Do not proceed to Phase B Basic Auth removal without another independent review and explicit approval.

Evidence allowed:
- Command names.
- Exit status.
- Sanitized Preview project ref.
- Normalized Preview test email.
- Created/updated/disabled/revoked status.
- PASS/FAIL outcome.

Evidence prohibited:
- Secret values.
- Service-role keys.
- OTPs.
- TOTP secrets or setup URIs.
- Recovery codes.
- Session tokens.
- Cookies.
- Auth headers.
- Raw database rows.

## Abort Conditions

Abort immediately if:

- Preview and Production refs are equal.
- Preview URL does not resolve to the Preview ref.
- Production credentials appear anywhere.
- Migration/table verification fails.
- OTP mailbox does not work.
- Basic Auth is unexpectedly absent.
- The Preview URL redirects to Production.
- Dry-run attempts a write.
- Cleanup fails.
- Any secret appears in logs or artifacts.

## Post-Run Stop

After a successful B1 Preview execution:

- [ ] Record sanitized evidence in `STATE.md` and `loop-run-log.md`.
- [ ] Request independent review of the evidence.
- [ ] Do not remove Basic Auth.
- [ ] Do not start Phase B2/B3 without explicit approval.
