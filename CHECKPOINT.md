# ApplyWizard Email Tracker — Phase 6A Checkpoint

This document serves as the final checkpoint for Phase 6A of the **ApplyWizard Email Tracker** project.

---

## 1. Current Phase Completed

### Phase 6A: Manual Sync + Classification Orchestrator

- **Shared Library Modules:** Extracted all business logic out of the two test routes into:
  - `lib/zoho/syncEmails.ts` — reusable `syncEmails()` function (Phase 5A logic)
  - `lib/zoho/classifyEmails.ts` — reusable `classifyEmails()` function (Phase 5B/5B.1 logic)
- **Thin Wrappers:** Refactored `app/api/zoho/emails/sync/test/route.ts` and `app/api/zoho/emails/classify/test/route.ts` to call the lib functions; identical response shapes, zero logic duplication.
- **Orchestrator Route:** Created `POST /api/zoho/workflow/test` which runs sync then classify in sequence and returns a single combined summary.
- **Strict Boundaries:** No cron, no daemon, no scheduler, no dashboard, no email body storage, no secrets in logs or responses.

---

## 2. Commit History

Below are the recent commits on the current branch (`main`):

- **`1fd9970`** Phase 6A: extract sync/classify logic into lib/zoho and add POST /api/zoho/workflow/test orchestrator
- **`15d2b44`** docs: create Phase 5B.1 final checkpoint
- **`0d1c445`** Phase 5B.1: enable retry for failed classifications by querying both pending and failed status values
- **`00ab960`** Phase 5B: implement metadata classification migration and POST /api/zoho/emails/classify/test route
- **`cf4fc0d`** Phase 5A: implement zoho_email_metadata schema and POST /api/zoho/emails/sync/test route

---

## 3. API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/zoho/login` | GET | Start Zoho OAuth flow |
| `/api/zoho/callback` | GET | Handle Zoho OAuth callback |
| `/api/zoho/emails/sync/test` | POST | Sync latest email metadata from Zoho |
| `/api/zoho/emails/classify/test` | POST | Classify pending/failed records |
| `/api/zoho/workflow/test` | POST | **Phase 6A** — Orchestrate sync + classify in one call |

---

## 4. Environment Variables Required

```ini
# -- Zoho OAuth --
ZOHO_CLIENT_ID=YOUR_CLIENT_ID_HERE
ZOHO_CLIENT_SECRET=YOUR_CLIENT_SECRET_HERE
ZOHO_REDIRECT_URI=https://applywizard.ai/api/zoho/callback
ZOHO_ACCOUNTS_BASE_URL=https://accounts.zoho.in
ZOHO_MAIL_BASE_URL=https://mail.zoho.in/api
ZOHO_ADMIN_EMAIL=ramakrishn@applywizard.ai

# -- AI Classification --
OPENAI_API_KEY=YOUR_OPENAI_API_KEY_HERE

# -- Supabase --
NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL_HERE
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE
```

---

## 5. Known Limitations

- **Manual Trigger Only:** The workflow route must be called manually. No automated scheduling yet (Phase 6B).
- **No Email Body Persistence:** Email bodies are discarded immediately after classification and are never stored.
- **Batch Size:** Classification processes up to 5 pending/failed records per invocation.

---

## 6. Next Recommended Phase

### Phase 6B: Protected Scheduled Trigger
1. Add a protected cron or scheduled endpoint that automatically calls the workflow orchestrator on a fixed interval.
2. Secure the trigger with a shared secret header so it cannot be called by arbitrary external parties.
