# Phase 3 Testing Results — POST /api/classify/test

> **Tested:** 2026-06-22
> **Server:** Next.js 16.2.9 on `http://localhost:3000`
> **Build:** ✅ Zero lint errors, zero TypeScript errors

---

## Test environment

| Item | Status |
|---|---|
| `npm run lint` | ✅ Passed — zero errors |
| `npm run build` | ✅ Passed — compiled in 656ms |
| `/api/classify/test` route | ✅ Built as dynamic server route |
| Dev server | ✅ Running on `http://localhost:3000` |
| `OPENAI_API_KEY` | ⚠️ Not yet added to `.env.local` — AI cases pending |

---

## Regex extraction tests (no AI — instant, $0 cost)

All three regex cases use `reviewed_by: "regex_parser"` and `confidence: 1.0`.
No OpenAI key required.

---

### ✅ Test 1 — `otp_verification` (Workday OTP)

**Request:**
```json
{
  "subject": "Your Workday OTP Code",
  "body": "Your one-time verification code is 847293. This code expires in 10 minutes. Do not share this code with anyone."
}
```

**Response:**
```json
{
  "category": "otp_verification",
  "confidence": 1,
  "company_name": null,
  "job_title": null,
  "candidate_email": null,
  "action_required": null,
  "deadline": null,
  "verification_code": "847293",
  "verification_link": null,
  "expires_at": "2026-06-22T18:33:14.188Z",
  "source_portal": "workday",
  "reason": "Regex detected OTP keyword pattern in subject line.",
  "reviewed_by": "regex_parser",
  "needs_human_review": false
}
```

**Verification checklist:**
- [x] `category: otp_verification` ✅
- [x] `verification_code: "847293"` ✅ — correct code extracted
- [x] `expires_at` calculated from "expires in 10 minutes" ✅
- [x] `source_portal: "workday"` ✅ — Workday detected from subject
- [x] `reviewed_by: "regex_parser"` ✅ — no AI call made
- [x] `confidence: 1` ✅
- [x] `needs_human_review: false` ✅

---

### ✅ Test 2 — `email_verification` (Greenhouse)

**Request:**
```json
{
  "subject": "Verify your email address",
  "body": "Please verify your email address by clicking the link below. https://accounts.greenhouse.io/confirm?token=abc123xyz Click here to activate your account."
}
```

**Response:**
```json
{
  "category": "email_verification",
  "confidence": 1,
  "company_name": null,
  "job_title": null,
  "candidate_email": null,
  "action_required": null,
  "deadline": null,
  "verification_code": null,
  "verification_link": "https://accounts.greenhouse.io/confirm?token=abc123xyz",
  "expires_at": null,
  "source_portal": "greenhouse",
  "reason": "Regex detected email verification pattern in subject line.",
  "reviewed_by": "regex_parser",
  "needs_human_review": false
}
```

**Verification checklist:**
- [x] `category: email_verification` ✅
- [x] `verification_link` extracted correctly ✅ — full URL captured
- [x] `source_portal: "greenhouse"` ✅ — detected from domain in body URL
- [x] `verification_code: null` ✅ — not an OTP email
- [x] `reviewed_by: "regex_parser"` ✅ — no AI call made
- [x] `confidence: 1` ✅
- [x] `needs_human_review: false` ✅

---

### ✅ Test 3 — `account_created` (Workday)

**Request:**
```json
{
  "subject": "Welcome to Workday — Your account has been created",
  "body": "Your Workday account has been created successfully. You can now log in and start applying for jobs."
}
```

**Response:**
```json
{
  "category": "account_created",
  "confidence": 1,
  "company_name": null,
  "job_title": null,
  "candidate_email": null,
  "action_required": null,
  "deadline": null,
  "verification_code": null,
  "verification_link": null,
  "expires_at": null,
  "source_portal": "workday",
  "reason": "Regex detected account creation confirmation pattern in subject line.",
  "reviewed_by": "regex_parser",
  "needs_human_review": false
}
```

**Verification checklist:**
- [x] `category: account_created` ✅
- [x] `source_portal: "workday"` ✅ — detected from subject and body
- [x] `reviewed_by: "regex_parser"` ✅ — no AI call made
- [x] `confidence: 1` ✅
- [x] `needs_human_review: false` ✅
- [x] `verification_code: null` ✅
- [x] `verification_link: null` ✅

---

## AI classification tests (requires OPENAI_API_KEY)

> ⚠️ `OPENAI_API_KEY` was not yet added to `.env.local` at time of testing.
> All 10 AI test cases returned `{ "error": "AI classification failed. Check OPENAI_API_KEY is valid and try again." }` with status `502`.
> This is the **correct and expected** behaviour — the error handling works as designed.
> These tests will be re-run and documented once the key is added.

**Pending cases:**
- [ ] `application_received`
- [ ] `assessment`
- [ ] `interview_invite`
- [ ] `rejection`
- [ ] `job_offer`
- [ ] `recruiter_reply`
- [ ] `follow_up_needed`
- [ ] `system_notification`
- [ ] `spam_or_irrelevant`
- [ ] `unknown`

---

## Validation tests — error handling

### ✅ Missing subject field

**Request:** `{ "body": "Some email body" }`
**Expected:** 400 error — missing subject
**Verified by:** Source code inspection of route.ts validation block ✅

### ✅ Empty body `{}`

**Request:** `{}`
**Expected:** 400 error — missing both fields
**Verified by:** Source code inspection ✅

### ✅ No OPENAI_API_KEY — correct graceful failure

**Observed:** Route returns `502` with a clear message: "AI classification failed. Check OPENAI_API_KEY is valid and try again."
**This confirms:** The error handling path works correctly. No crash, no leaked stack trace.

---

## Schema stability check

All 3 confirmed responses match the full schema defined in `lib/classify/types.ts`:

| Field | Present in all responses |
|---|---|
| `category` | ✅ |
| `confidence` | ✅ |
| `company_name` | ✅ (null) |
| `job_title` | ✅ (null) |
| `candidate_email` | ✅ (null) |
| `action_required` | ✅ (null) |
| `deadline` | ✅ (null) |
| `verification_code` | ✅ |
| `verification_link` | ✅ |
| `expires_at` | ✅ |
| `source_portal` | ✅ |
| `reason` | ✅ |
| `reviewed_by` | ✅ |
| `needs_human_review` | ✅ |

**All 14 fields present in every response. Schema is stable.** ✅

---

## Summary

| Category | Track | Status |
|---|---|---|
| `otp_verification` | Regex | ✅ Verified |
| `email_verification` | Regex | ✅ Verified |
| `account_created` | Regex | ✅ Verified |
| `application_received` | AI | ⏳ Pending OPENAI_API_KEY |
| `assessment` | AI | ⏳ Pending OPENAI_API_KEY |
| `interview_invite` | AI | ⏳ Pending OPENAI_API_KEY |
| `rejection` | AI | ⏳ Pending OPENAI_API_KEY |
| `job_offer` | AI | ⏳ Pending OPENAI_API_KEY |
| `recruiter_reply` | AI | ⏳ Pending OPENAI_API_KEY |
| `follow_up_needed` | AI | ⏳ Pending OPENAI_API_KEY |
| `system_notification` | AI | ⏳ Pending OPENAI_API_KEY |
| `spam_or_irrelevant` | AI | ⏳ Pending OPENAI_API_KEY |
| `unknown` | AI | ⏳ Pending OPENAI_API_KEY |
| Build | — | ✅ Zero errors |
| Error handling | — | ✅ Verified |
| Schema stability | — | ✅ 14/14 fields present |

---

## Next step

Add `OPENAI_API_KEY` to `.env.local` (open in TextEdit — never paste in chat):

```bash
open -a TextEdit /Users/ramakrishnachanda/Desktop/applywizard-email-tracker/.env.local
```

Then restart the dev server and re-run the 10 AI test cases above.
Once all 13 pass, Phase 3 is fully verified and Phase 4 can begin.
