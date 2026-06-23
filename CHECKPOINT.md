# ApplyWizard Email Tracker — Phase 6B Checkpoint

This document serves as the final checkpoint for Phase 6B of the **ApplyWizard Email Tracker** project.

---

## 1. Current Phase Completed

### Phase 6B: Protected Scheduled Trigger

- **Cron Route:** Created `GET /api/zoho/workflow/cron` — a protected endpoint that
  Vercel Cron invokes once daily at 02:00 UTC.
- **Fail-Closed Auth:** If `CRON_SECRET` is not configured on the server, the route
  returns `401` immediately and never executes any workflow logic.
- **Bearer Token Check:** The `Authorization` header must match `Bearer <CRON_SECRET>`
  exactly. Missing or wrong header → `401`. Correct header → workflow runs.
- **No Secret Leakage:** `CRON_SECRET`, tokens, and email content are never logged or
  returned in any response.
- **Reuse Only:** Calls `syncEmails()` and `classifyEmails()` from `lib/zoho/`.
  Zero new business logic.
- **Vercel Schedule:** `vercel.json` registers one cron entry at `0 2 * * *`
  (02:00 UTC daily), which Vercel Hobby plan supports.

---

## 2. Commit History

Below are the recent commits on the current branch (`main`):

- **`be3ff27`** Phase 6B: add protected GET /api/zoho/workflow/cron with CRON_SECRET auth and vercel.json daily schedule
- **`4876d23`** docs: create Phase 6A final checkpoint
- **`1fd9970`** Phase 6A: extract sync/classify logic into lib/zoho and add POST /api/zoho/workflow/test orchestrator
- **`15d2b44`** docs: create Phase 5B.1 final checkpoint
- **`0d1c445`** Phase 5B.1: enable retry for failed classifications

---

## 3. API Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/zoho/login` | GET | None | Start Zoho OAuth flow |
| `/api/zoho/callback` | GET | None | Handle Zoho OAuth callback |
| `/api/zoho/emails/sync/test` | POST | None | Manual: sync email metadata |
| `/api/zoho/emails/classify/test` | POST | None | Manual: classify pending records |
| `/api/zoho/workflow/test` | POST | None | Manual: sync + classify in one call |
| `/api/zoho/workflow/cron` | GET | Bearer CRON_SECRET | **Phase 6B** — scheduled trigger |

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

# -- Cron Security (Phase 6B) --
# Generate with: openssl rand -hex 32
# Add same value to Vercel → Project → Settings → Environment Variables
CRON_SECRET=YOUR_CRON_SECRET_HERE
```

---

## 5. Vercel Deployment Steps for Phase 6B

1. Generate a secret locally: `openssl rand -hex 32`
2. Add `CRON_SECRET=<value>` to `.env.local` for local testing.
3. Add the same `CRON_SECRET` to **Vercel → Project → Settings → Environment Variables**.
4. Deploy. Vercel automatically reads `vercel.json` and registers the cron job.
5. Vercel will call `GET /api/zoho/workflow/cron` daily at 02:00 UTC, supplying the
   `Authorization: Bearer <CRON_SECRET>` header automatically.

---

## 6. Security Verification Results

| Test | Expected | Result |
|---|---|---|
| Missing `Authorization` header | `401` | ✅ `401` |
| Wrong `Authorization` value | `401` | ✅ `401` |
| Correct `Authorization: Bearer <secret>` | `200` + safe counts | ✅ `200` |
| `CRON_SECRET` not set on server | `401` (fail closed) | ✅ `401` |

---

## 7. Known Limitations

- **Hobby Plan Rate:** Once-daily is the maximum frequency on Vercel Hobby. Pro plan
  supports up to once per minute.
- **No Retry on Cron Failure:** If Vercel's cron invocation fails (e.g. timeout), it
  does not retry automatically. Failed records remain in `failed` status and will be
  picked up on the next daily run.

---

## 8. Next Recommended Phase

### Phase 7: Email Dashboard
Display classified email metadata in a read-only dashboard UI —
category, confidence, sender, subject, and received date — sourced
directly from `zoho_email_metadata`. No email body display.
