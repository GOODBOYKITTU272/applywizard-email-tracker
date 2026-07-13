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
- 2026-07-13 (hosted Preview B1 rerun — FAIL: operator OTP never entered; not a code/Graph/safety defect): Reused the existing 851ead9 Preview deployment email-apply-wizz-llq7qf5yo…vercel.app (no new deployment; reveal control confirmed present in deployed bundle chunk). Pre-run all green: target=preview/Ready, Basic Auth 401→200 (no prod redirect), Supabase binding obirkjbzpykoehxacaaj (key ref + URL host), stale procs killed, test user disabled+revoked then seeded fresh (active, admin_ceo, totp_enabled=false, previous/compromised TOTP secret wiped: totp_secret_encrypted=null), 0 active sessions. Graph OTP delivery worked (login_otp_requested success=true). FAILURE CAUSE: the operator OTP was never delivered to the local FIFO — audit shows no login_otp_verify, latest OTP used=no attempts=0; the harness waited at the email-OTP prompt until its 10-minute operator-input timeout (PREVIEW_E2E_OTP_INPUT_TIMEOUT_MS) fired, threw, and ran mandatory cleanup. (The placeholder `000000` printf was pasted into chat instead of run in the operator terminal with the real code.) Mandatory cleanup succeeded: user disabled, active sessions 0, browser/harness procs 0, FIFO removed. Per the single-run rule, NO auto-retry was performed. Observability note (not fixed here): a thrown operator-timeout surfaces at the CLI as UNKNOWN_ERROR because runPreviewDashboardAuthE2EWithDeps propagates thrown errors instead of mapping them to a coded {ok:false} result — cleanup still runs; only the reported code is uninformative. Production never accessed (not visible from this CLI login); Basic Auth unchanged; nothing pushed or deployed. To rerun: reseed (idempotent) and enter the real OTP in the terminal within the validity window.
- 2026-07-13 (Preview-only synthetic demo seed for dashboard QA): Added a pure, deterministic synthetic dataset builder (`lib/previewDemo/dataset.ts`) plus a guarded runner (`scripts/preview-demo/seed-preview-demo.ts`) so the Overview dashboard shows non-zero values in the isolated Preview project. Marker: `preview_demo_v1` (stored in `zoho_email_metadata.folder_id`, and `zoho_sync_checkpoints.last_seen_message_id`). Guard is mandatory: refuses unless `SUPABASE_PROJECT_REF=obirkjbzpykoehxacaaj` AND the resolved `NEXT_PUBLIC_SUPABASE_URL` ref equals Preview and is not Production `nkkfsrhfttixwjbglhgg`; no secrets/service-role creds committed (read from operator env only). Modes: default dry-run, `--apply`, `--cleanup` (unknown/conflicting flags refused). Applied 24 synthetic email rows + 1 checkpoint; idempotent (re-apply stayed at 24, not 48 — apply deletes marked rows first). All values fictional (`example.test` domain, companies Northstar Labs/BluePeak Systems/CedarWorks/DemoCorp/SampleTech, `preview-demo-` message ids). Verified via direct Preview queries (same service-role path the app uses): total 24; received last 24h=5, 24-48h=4, 7d=15, 30d=21 (date filters differ); status cards pending 4 / processing 2 / retry_scheduled 2 / classified 11 / review 2 / dead_letter 1 / historical_ingested 2; deadline==tomorrow 2; classified-in-last-24h 2; checkpoint `last_successful_sync_at` set so "Latest ingest" now shows a timestamp. No API/RLS errors (service role bypasses RLS). Cleanup command: `set -a; source .env.preview-operator.local; set +a; SUPABASE_PROJECT_REF=obirkjbzpykoehxacaaj npx tsx scripts/preview-demo/seed-preview-demo.ts --cleanup` (removes only `preview_demo_v1`-marked rows). Also cleaned up the abandoned prior hosted-B1 rerun (killed wedged harness+browser, disabled test user, 0 active sessions). Production never accessed (not visible from this CLI login); no worker/ingestion run; no real mailbox contacted. Focused tests 11, full Vitest 558, lint/build pass, git diff --check clean. Not pushed, not deployed.
- 2026-07-13 (hosted Preview B1 second attempt — FAIL: harness branch-detection race; Graph now works): Approved commits 53d70ec/4fe2d2c/72512f0 pushed (9827039..72512f0, no force, backup 794fce7 untouched). New Vercel Preview deployment email-apply-wizz-ff2wqryfo…vercel.app (target=preview, Ready); Basic Auth active (401→200 with Preview secret, no prod redirect). All 15 Preview env vars present; Supabase connectivity + 4 auth tables verified. CLI smokes refused correctly (INVALID_TARGET, UNKNOWN_FLAG). Dry-run zero-write proven (users 1→1). Seed idempotent (updated; admin_ceo/active/totp_enabled=false). GRAPH OTP DELIVERY NOW WORKS: login_otp_requested success=true and login_otp_verify success=true — the first email OTP was delivered, entered by the operator, and verified. BLOCKING DEFECT FOUND (harness, not Graph, not safety): after clicking Continue the reviewed harness calls revealSetupKey.isVisible() immediately, a one-shot check with no wait; the setup screen (QR + "Can't scan? Show setup key") had not finished rendering, so isVisible returned false and the harness took the LOGIN branch and prompted for an authenticator code while the page was actually on the first-time SETUP step (user totp_enabled stayed false, no totp_setup_completed event). The earlier LOCAL validation masked this because its driver used waitForSelector on either the setup-secret OR login-code control; the reviewed previewE2eHarness.ts branch detection does not wait. Hardening validated in production: driving a placeholder in triggered the bounded 30s action timeout, the harness threw, mandatory cleanup ran automatically (user disabled, 0 active sessions), and zero browser/harness processes remained — commits 4fe2d2c/72512f0 confirmed working end-to-end. No auto-retry (per rule). Cleanup final: user disabled, active sessions 0. Production never contacted (not visible from this CLI login). REQUIRED FIX before rerun (needs independent review): make authenticatePreviewSession branch detection wait for either the setup control or the login control to appear (e.g. await Promise.race / page.waitForSelector on '[data-testid=dashboard-auth-show-setup-key], [data-testid=dashboard-auth-login-code]') before choosing the branch, instead of an immediate isVisible() check.
- 2026-07-12 (hosted Preview B1 first attempt — ABORTED at OTP delivery): Gate 4 executed with owner approval: worker-preflight pushed 7d1a29d..9827039 (no force, backup untouched); Vercel Preview deployment created from the clean tree at HEAD 9827039 (email-apply-wizz-kl8n1qidb…vercel.app, target=preview, Ready); app middleware Basic Auth confirmed active on Preview (401 realm "ApplyWizard Dashboard", not Vercel SSO; authenticated 200; no production redirect). CLI smokes passed (INVALID_TARGET, UNKNOWN_FLAG, both exit 1). Hosted dry-run passed (would_create, ref obir...caaj, zero writes proven by 0→0 row counts). Real seed passed and is idempotent (created → updated; exactly one user admin_ceo/active). Reviewed harness launched with FIFO-stdin operator protocol, passed all environment guards and the hosted Basic Auth gate, and requested a real OTP. ABORT CAUSE: Microsoft Graph send failed — OTP row created in Preview DB but both login_otp_requested audit events recorded success=false; deployment logs show POST /api/dashboard/auth/request-otp 200; the app swallows Graph error detail by design so the exact Graph failure (token acquisition vs Mail.Send permission/consent vs sender mailbox) is indistinguishable without owner-side Entra checks. No OTP ever arrived; run formally aborted; harness wedged on Playwright's no-default-action-timeout and was hard-stopped; formal cleanup ran via reviewed seed-preview-admin --disable (user disabled, sessions total 0 active 0, no login ever occurred). Production untouched throughout. Owner corrections required: Mail.Send application permission + admin consent, MICROSOFT_OTP_FROM_EMAIL is a real licensed mailbox, ApplicationAccessPolicy includes the sender. Re-run plan: fix Graph, re-seed (idempotent), fresh harness run.
- 2026-07-12 (Gate 1 + Gate 2 infrastructure execution): Dedicated Preview Supabase project `obirkjbzpykoehxacaaj` (applywizard-email-tracker-preview) created by owner under a separate CLI account that cannot see Production; repo linked to it; owner approved and all 15 migrations applied via `supabase db push` (exit 0, 15/15 recorded, 4 auth tables + 6 business tables verified). Gate 2 executed via non-interactive piped `vercel env add`: all nine DASHBOARD_* vars added to Preview scope; NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are now separate per-scope records (Preview → obirkjbzpykoehxacaaj, Production → nkkfsrhfttixwjbglhgg, both key refs verified by local JWT decode; no values printed). Four Preview secrets freshly generated (openssl rand -hex 32; TOTP key format confirmed fine since totp.ts derives via SHA-256). Operator file `.env.preview-operator.local` created (gitignored, mode 600) for the local seed/E2E harness because this Vercel project stores env values as unreadable-after-creation. INCIDENT (disclosed): `vercel env rm <name> preview` deleted the entire shared records, briefly removing Production's Supabase URL/key bindings; restored within minutes from `.env.local` values (restored key decoded to ref nkkfsrhfttixwjbglhgg role service_role); live production deployment was never affected (baked env), no production build occurred during the gap. Gate 3 (test mailbox) remains owner-unconfirmed. No git push, no deploy, no seed, no E2E.
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
