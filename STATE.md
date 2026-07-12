# Loop State — ApplyWizz Email Tracker

Project:
ApplyWizz Email Tracker — Dashboard Auth Phase 1

Repository:
~/Desktop/applywizard-email-tracker

Production:
https://email-apply-wizz.vercel.app

Current live authentication:
Basic Auth remains active.

Completed and reviewed:
- Slice 1: dashboard auth database migration
- Slice 2: server-only auth helpers
- Slice 3: session database helpers
- Slice 4: Microsoft Graph OTP sender
- Slice 5: OTP database flow helpers
- Slice 6: TOTP/Authenticator crypto helpers
- Slice 7: server-side auth orchestration
- Slice 8: OTP/TOTP rate limiting
- Slice 9: signed login challenges
- Slice 10: HTTP route handlers + secure session cookie wiring
- Slice 11: dashboard auth frontend, dashboard restoration, and server-side login session validation
  - Status: PASS
  - Implementation/fix commit: f72998af4041cb094d66d727cc88a01815ce4621
  - Independent review verdict: APPROVED
  - Reviewer: Fable independent re-review
  - Blocking findings: none

Current slice:
- Slice 12 Phase A implemented: dashboard-session authorization layer underneath retained Basic Auth
- Status: PASS
- Approved plan commit: 29b31e9081d74d5631f735c97c14232ea626fbe6
- Pre-work HEAD: 29b31e9081d74d5631f735c97c14232ea626fbe6
- Implementation commit: c20863990b2b926ac68e1232934034f943593843
- Independent reviewer verdict: APPROVED
- Reviewer: Claude/Fable independent code and security review
- Blocking findings: none
- Basic Auth remains active.
- Phase B planning is approved through revised plan commit f9fb3cb08f65a9eefdb38edc360b44142d853861.
- Phase B1 tooling preparation fixes are implemented locally after independent review.
- Phase B Basic Auth removal has not started and remains blocked pending Preview setup, real database-backed E2E evidence, and independent review.
- No production changes have occurred.
- No deployment has occurred.

Phase B plan review status:
- Initial Phase B plan review verdict: CHANGES REQUIRED
- The review did not reject the architecture; it required six infrastructure/operational corrections:
  1. Resolve Preview database isolation honestly (single Supabase configuration today; dedicated Preview Supabase project is the recommended default, shared-DB testing only as an owner-declined fallback with mandatory cleanup).
  2. Specify OTP retrieval for the real E2E (local operator-assisted headed Playwright; no Graph mailbox-read automation in B1).
  3. Name the Preview deployment mechanism (vercel deploy from local worker-preflight; never the vercel-prod remote; Deployment Protection bypass handled without printing secrets).
  4. Add a Vercel WAF rate-limit rule on /api/dashboard/auth/* (~20 req/min/IP) as a blocking B3 prerequisite before Basic Auth removal reaches production.
  5. Make post-E2E test-user cleanup mandatory (disable + revoke-all after every run; cleanup failure fails B1).
  6. Formalize B1/B2/B3 phase gates with explicit entry/exit conditions.
- All six corrections are now incorporated into the revised plan document.
- Owner approved creating and using a dedicated non-production Preview Supabase project for Phase B1.
- Owner approved the Preview OTP mailbox direction: use a dedicated company-owned mailbox such as `dashboard-auth-test@applywizz.ai`.
- Mailbox creation and Microsoft Graph OTP receipt verification remain operational prerequisites until the owner confirms them.
- Phase B1 tooling fix review verdict: APPROVED.
- Approved fix commit: 66d0c855e3d8efe4beaa6b2487c573c19f654b39.
- Tooling is approved for Preview-only execution once the required infrastructure exists.
- Production execution remains prohibited.
- No real Preview execution has happened.
- Infrastructure creation and Preview execution remain pending.
- Unknown-flag CLI hardening has been added after approval.

Phase B1 first-execution pre-flight (2026-07-12, Claude Code session):
- Hardening/runbook commit e420ead37e42cc974f3ddcb34724fd0acf0ae37c diff-reviewed: UNKNOWN_FLAG allowlist rejection plus execution checklist; approved.
- HEAD verified green: full Vitest 523 tests passed, lint passed, build passed.
- Gate 5 step 1 completed: no-environment CLI smoke refused with INVALID_TARGET (exit 1); unknown-flag smoke refused with UNKNOWN_FLAG; conflicting-flags smoke refused with CONFLICTING_FLAGS. No database contact occurred.
- Gate 2 presence-only audit via vercel env ls preview (names only, no values):
  - PRESENT in Preview scope: MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_OTP_FROM_EMAIL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
  - MISSING from Preview scope: DASHBOARD_AUTH_E2E_TARGET, DASHBOARD_AUTH_SEED_TARGET, DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF, DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF, DASHBOARD_SESSION_SECRET, DASHBOARD_TOTP_ENCRYPTION_KEY, DASHBOARD_LOGIN_CHALLENGE_SECRET, DASHBOARD_SECRET, DASHBOARD_TEST_ADMIN_EMAIL.
  - HAZARD: Preview-scope NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are single values shared with Production, so a Preview deployment today would point at the production database. These must be overridden with dedicated Preview Supabase values in the Preview scope before any deploy/seed/E2E.
  - HAZARD: DASHBOARD_SECRET absent from Preview scope means a Preview deployment would fail closed (Basic Auth 401 on every protected path, login unreachable) until added.
- Gate 1 (dedicated Preview Supabase project) and Gate 3 (test mailbox) show no evidence of existing yet; both are owner infrastructure actions.
- Execution stopped at the Gate 1-4 human/infrastructure boundary. No push, no deploy, no seed, no database contact, no env change.
- Phase B1 tooling review verdict before fix: CHANGES REQUIRED.
- Review blocking findings:
  1. CLI/E2E execution imported the server-only session store path.
  2. E2E soft navigation targeted a non-existent Mailboxes navigation link.
  3. E2E startup did not require `DASHBOARD_AUTH_SEED_TARGET=preview` before cleanup.
  4. `--disable --dry-run` was ambiguous and not rejected.
  5. Production Supabase project reference was optional instead of mandatory.
- Phase B1 tooling status: APPROVED FOR PREVIEW-ONLY EXECUTION AFTER INFRASTRUCTURE SETUP; UNKNOWN-FLAG HARDENING IMPLEMENTED LOCALLY.
- No Supabase project, seed, environment, push, or deployment changes have occurred.

Current rules:
- Basic Auth must remain active until an explicitly approved slice changes it.
- No push or deploy without explicit Ramakrishna approval.
- No middleware switch without an approved slice.
- No secret values in state files.
- No migrations without explicit approval.
- Every implementation must be reviewed before the next slice.
- Every slice must run tests, lint, and build.
- Stop at every human approval gate.

Slice 11 approval evidence:
- Playwright: 12/12 passed
- Login-page unit tests: 9/9 passed
- Dashboard-auth tests: 84/84 passed
- Full Vitest: 53 files / 433 tests passed
- Lint passed
- Build passed
- /dashboard restored byte-for-byte from fdd1caf
- Auth UI moved to /dashboard/login
- Login redirect now depends on full server-side session validation with getDashboardSessionByToken, not cookie presence
- No push or deployment has occurred

Slice 11 non-blocking observations:
- During successful login/setup navigation, the submission lock may be released before router.replace("/overview") completes, allowing a cosmetic generic-error flash on a rapid re-click. No duplicate request or sensitive exposure occurs.
- A genuine valid-session database-backed E2E test remains deferred to the future middleware/session-switch work.
- Production rollout still requires DASHBOARD_TOTP_ENCRYPTION_KEY, DASHBOARD_LOGIN_CHALLENGE_SECRET, seeded dashboard_users, and completion/review of the middleware/session-switch slice.

Next expected human-approved task:
- Owner infrastructure setup and controlled Preview-only execution using the Phase B1 runbook; no Production execution, Phase B removal, push, or deploy without explicit approval.

Last run:
- 2026-07-12 (local-only Phase B1 validation): LOCAL DB-BACKED AUTH E2E PASS — 13/13 stages. Environment: local Docker Supabase (API 127.0.0.1:54321, DB 127.0.0.1:54322), repo unlinked from all remote projects, `.env.local`/`.env.production.local` parked during the run so the local Next.js dev server (localhost:3111) ran with only six explicitly passed local/random values; production was never contacted. Local schema: all 4 dashboard-auth tables verified present. Reviewed seed CLI correctly refused the local URL with MALFORMED_SUPABASE_URL exit 1 before client creation (guard is hosted-only by design); local admin was seeded via direct SQL mirroring the tool's exact row (admin_ceo/active). OTP: Mailpit NOT applicable — Graph hosts are hardcoded; the flow stores the hashed OTP before send, so the driver injected a known-code hash into the local row after each real request (send itself failed as expected without Graph creds, recorded success=false in audit). Stages passed: Basic Auth 401 gate, login page under Basic Auth, OTP verify + TOTP setup + session creation landing on /overview, /dashboard Email Tracker identity, revoke-all scoped to exact user id with revoked_at IS NULL, Clients soft-navigation denial after revocation, re-authentication with existing TOTP, logout ok, session cookie cleared, all DB sessions revoked, post-logout /overview denial, mandatory cleanup (user disabled, active sessions=0, no other users). DB evidence: users_total=1, sessions_total=2 active=0, otps_total=2 unused=0, audit: 2×login_otp_requested(success=false, Graph send), 2×login_otp_verify(success=true), 1×totp_setup_completed(true), 1×login_totp_verify(true). Baselines re-verified same session: full Vitest 58 files / 523 tests pass, lint pass, build pass (known middleware deprecation warning), git diff --check pass. First driver attempt failed benignly at OTP stage (dev server blocked JS assets from the 127.0.0.1 origin so the page never hydrated); cleanup ran, user was re-seeded, rerun via localhost passed — recorded per the no-clean-rewrite rule. This is NOT hosted Vercel Preview E2E completion: Gates 1–3 (dedicated Preview Supabase project, 9 Preview-scope env vars with Preview Supabase overrides, test mailbox with real Graph OTP delivery) remain owner infrastructure prerequisites, and the real Graph email send path remains untested.
- 2026-07-12 (safety correction): Repo Supabase CLI link to production (`nkkfsrhfttixwjbglhgg`) removed via `supabase unlink`, which deleted only the generated `supabase/.temp/` link metadata (project-ref, linked-project.json, pooler-url, version caches). `supabase/config.toml` and all 15 migration files untouched. Verified: `supabase migration list --linked` now refuses with "Cannot find project ref" (exit 1). No database read/write occurred; production untouched. Repo is now linked to no Supabase project. Next owner action: create the dedicated Preview Supabase project, then provide its new ref for relink and Gate 1 re-run before any migration command.
- 2026-07-12 (later session): Phase B1 resume attempt aborted at Gate 1. Operator stated a dedicated Preview Supabase project was linked as `nkkfsrhfttixwjbglhgg`; verification via `supabase projects list` shows that ref is the original production project ("zoho mail", created 2026-06-22) — the same ref as the production `NEXT_PUBLIC_SUPABASE_URL`. The only other project in the account ("sign document", `itnjcufoapntnlpptjdo`) is unrelated. No dedicated Preview Supabase project exists. Gate 2 unchanged: all nine DASHBOARD_* vars still missing from the Vercel Preview scope; Preview-scope Supabase URL/key still shared with Production. Gate 3 mailbox still unconfirmed. Git safety checks all passed (branch worker-preflight, tree clean, HEAD 9188c96, backup local+remote at 794fce7, approved commits in history). Checkpoint push gate NOT ready (checklist Gate 4 requires Gates 1–3). Disclosure: earlier the same day, in a routine CLI session before this execution prompt, the repo was linked to `nkkfsrhfttixwjbglhgg` and a read-only `supabase migration list` ran against it (production) — no writes; the repo remains linked to production, so `supabase db push`/`db reset` in this repo would target production until relinked. No push, no deploy, no seed, no browser launch, no env change.
- 2026-07-12: Phase B1 first controlled execution was authorized and attempted. All Section 1 safety checks passed; local verification matched baselines (focused 2 files / 46 tests, lib 18 files / 161 tests, full 58 files / 523 tests, lint/build/git diff --check pass); CLI smokes refused correctly (INVALID_TARGET and UNKNOWN_FLAG, both exit 1, no database contact). Execution stopped at the Section 3 infrastructure gate: no dedicated Preview Supabase project exists, all nine DASHBOARD_* Preview-scope env vars are missing, Preview-scope Supabase URL/key are still shared with Production, and the test mailbox is unconfirmed. No push, no deploy, no database contact, no seed, no browser launch. This is not a test failure; owner-managed infrastructure prerequisites are missing.

Slice 12 Phase A implementation summary:
- Added server-only requireDashboardSession guard using the reviewed getDashboardSessionByToken helper.
- Guarded /dashboard, /overview, /live-monitor/email-arrival, /clients, /clients/[clientKey], /operations, /operations/interviews, /operations/interviews/[id], /review-queue, /applications, /applications/[applicationId], /mailboxes, and /ca-portfolio.
- Converted client-only mock operations pages to thin guarded server wrappers plus dedicated client components.
- Added POST /api/dashboard/auth/logout with Phase A Basic Auth, Origin validation, idempotent session revocation, and cookie clearing.
- Added logout action to the operations navigation with hard navigation to /dashboard/login.
- Added shared dashboard session cookie helper for set/clear consistency.
- Middleware remains Basic Auth only; no getDashboardSessionByToken import was added to middleware.
- app/dashboard/page.tsx DASHBOARD_SECRET check remains unchanged.
- Role-based authorization remains deferred; Slice 12 validates session usability only.
- Real database-backed valid-session E2E remains a Phase B prerequisite and was not claimed as completed in Phase A.

Slice 12 Phase A verification evidence:
- Focused guard/logout tests: 3 files / 43 tests passed
- Dashboard auth API tests: 7 files / 85 tests passed
- Login-page unit tests: 1 file / 9 tests passed
- DashboardAuth lib tests: 16 files / 115 tests passed
- Full Vitest: 56 files / 477 tests passed
- Playwright dashboard-auth desktop: 13/13 passed
- Lint passed
- Build passed with existing Next.js middleware deprecation warning
- git diff --check passed

Slice 12 Phase A non-blocking observations:
- logoutBusyRef is not reset after fetch failure, but the current hard navigation in finally prevents a persistent lock.
- Origin: null fails closed.
- Some guard failure-case labels reuse the same { ok: false } mocked path, while detailed distinctions remain covered by getDashboardSessionByToken() tests.
- Static route-guard coverage is a regression tripwire, not a substitute for the deferred real database-backed E2E.

Phase B prerequisites:
- Real database-backed valid-session E2E must revoke or expire a real valid session, then soft-navigate to another protected route and confirm denial.
- Real database-backed valid-session E2E must authenticate with a real valid session and confirm /dashboard renders the Email Tracker business UI.
- Phase B remains unimplemented and requires a separate approved plan before Basic Auth removal.
- Preview setup is mandatory before Phase B implementation:
  - verified Preview auth env vars by presence only
  - verified dashboard auth tables
  - at least one active Preview `admin_ceo` dashboard user
  - non-production test mailbox/account for OTP
  - approved cleanup/revocation process
- New Phase B plan:
  - docs/superpowers/plans/2026-07-12-dashboard-auth-phase-b-basic-auth-removal-plan.md

Phase B1 tooling summary:
- Preview-only seed/disable tool added for a dedicated test `admin_ceo` dashboard user.
- Tooling requires `DASHBOARD_AUTH_SEED_TARGET=preview`, `DASHBOARD_TEST_ADMIN_EMAIL`, `DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF`, and `DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF`.
- Tooling resolves the Supabase project reference from `NEXT_PUBLIC_SUPABASE_URL` and refuses missing/malformed/equal Preview and production refs, production ref matches, and mismatches.
- Disable mode marks the Preview test user disabled and revokes active sessions through an injected service-role update scoped to the exact Preview test user ID; CLI paths do not import the server-only session store.
- `--disable --dry-run` is rejected before Supabase client creation.
- Unknown CLI flags such as `--dryrun`, `--disable-user`, `--force`, and `--production` are rejected before environment validation or Supabase client creation.
- Local operator-assisted Preview E2E requires both Preview target flags, checks Basic Auth before launching Chromium, revokes sessions by Preview test user before soft navigation, and uses the existing Clients navigation link.
- Local operator-assisted Preview E2E harness is prepared but has not been executed.
- First execution checklist:
  - docs/superpowers/plans/2026-07-12-dashboard-auth-phase-b1-preview-execution-checklist.md
- Focused tooling tests: 2 files / 46 tests passed.
- DashboardAuth tests: 18 files / 161 tests passed.
- Full Vitest: 58 files / 523 tests passed.
- Lint passed.
- Build passed with existing Next.js middleware deprecation warning.
- git diff --check passed.
- No Supabase project has been created.
- No user has been seeded.
- No environment variables have been changed.
- No Preview deployment has been created.
- No production changes have occurred.

Loop readiness audit:
- 100/100 (L3), report-only safe start

Cost estimate:
- Daily Triage at L1 is above the suggested 100k/day cap on realistic usage; keep the loop report-only and low cadence until the next approved slice is needed.

Run log:
- loop-run-log.md
