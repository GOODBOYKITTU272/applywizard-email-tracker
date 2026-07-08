# Interview Drill-Down: Design Spec

**Status:** Approved for implementation planning
**Date:** 2026-07-08

## 1. Purpose

Today the operations `overview` dashboard shows aggregate counts per category (Applications, Interviews, Offers, Rejections, Recruiter Replies, Follow-up Needed, Review Queue) but the cards are not clickable — there is no way to see which emails make up a count. This project makes the **Interviews** card the first clickable drill-down: click the card, see a filtered, searchable table of the underlying emails, click a row, see that email's persisted metadata.

This is the first of a larger planned set (Applications, Assessments, Offers, Rejections, Recruiter Replies, Follow-up Needed, Review Queue all follow the same pattern later). Only Interviews is built in this project. The reusable table component is designed to generalize to the others without being built out for them yet.

## 2. Explicitly out of scope for this project

- ApplyWizz Leads API integration (real client name / assigned CA lookup). Planned as a separate future phase requiring its own auth, matching logic, caching, and failure handling.
- CA assignment, notes, follow-up dates, "Mark as Contacted/Scheduled" or any other mutating action.
- Workflow status labels (Scheduled, Awaiting Candidate Reply, Completed, etc.) — no schema exists for these; only the AI pipeline's `classification_status` exists, which is not the same thing.
- Multi-email candidate/client timeline (Section 12 of the original request). Requires real client identity resolution, which doesn't exist yet.
- Hy3, DeepSeek, or any change to the classification/confidence pipeline.
- Reclassifying or modifying any `historical_ingested` row, or any already-`classified`/`review` row.
- Any change to the live Render worker, its sync loop, or its checkpoint.
- Fetching or displaying raw Zoho email bodies, headers, attachments, OTPs, tokens, links, or secrets — nothing beyond already-persisted safe metadata columns.
- E2E (Playwright) test expansion — the existing suite doesn't cover `/operations/*` pages; not extending that in this project.

## 3. Data model change

Two new nullable columns on `zoho_email_metadata`:

```sql
alter table public.zoho_email_metadata
  add column company_name text,
  add column job_title text;
```

Additive, nullable, no existing column touched, no backfill of historical rows.

**Why these two columns, why now:** the AI classifier (`lib/classify/types.ts`, `ClassificationResult`) already computes `company_name` and `job_title` for every email it classifies. `lib/zoho/classifyEmails.ts` (the `updateClaimedEmail(...)` call around line 662) currently discards both instead of persisting them. This project adds them to that existing update payload — no new extraction logic, no new AI calls, no new cost.

**What this does and does not affect:**
- Newly classified emails going forward: `company_name`/`job_title` get saved when the classifier produces them.
- Already-`classified` rows (currently 380) and `review` rows (currently 50): untouched. Their `company_name`/`job_title` will be `NULL` since they were classified before this column existed. This is expected, not a bug.
- `historical_ingested` rows (currently 16,426+): untouched, not reclassified, not backfilled. Their `company_name`/`job_title` will be `NULL` permanently until a future, separately-scoped decision to classify them.
- The UI must show **"Not available yet"** for `NULL` values — never a fake/mock placeholder.

## 4. Interview filter definition (must match the dashboard exactly)

```
category = 'interview_invite' AND classification_status != 'dead_letter'
```

This is the exact filter already used by the `overview` dashboard's "Interviews" card count (`lib/zoho/cooWorkspace.ts`, line ~583). The detail page reuses this same definition so the card count and the detail page's total always agree — never two independently-derived counts that can drift apart.

## 5. Routes

- `app/(operations)/interviews/page.tsx` — list/table view. Existing convention: the `(operations)` route group already contains `applications`, `ca-portfolio`, `clients`, `mailboxes`, `operations`, `overview`, `review-queue`. This project adds `interviews` alongside them, in the same group. Resolves to the URL `/operations/interviews` (route groups in parens don't appear in the URL).
- `app/(operations)/interviews/[id]/page.tsx` — single-row "Email Metadata Details" view.

**Auth:** both routes are already covered by the existing `middleware.ts` — `PROTECTED_PATHS` includes `/operations` and `config.matcher` includes `/operations/:path*`. Verified by reading the current middleware; no changes needed for auth coverage.

**Anti-tampering on the detail route:** the single-row query must filter on `id = :id AND category = 'interview_invite' AND classification_status != 'dead_letter'` together, in the same query — not `id` alone. A manually-edited URL pointing at an id from a different category (or a dead-lettered row) must return zero rows, rendered as a not-found page, never the other category's data.

## 6. Components

- `lib/zoho/operationsTable.ts` — two functions:
  - `getInterviewRows(filters: { search?, dateFrom?, dateTo?, page })` — explicit-column Supabase query (never `select("*")`): `id, original_recipient, received_at, category, confidence, priority, deadline, action_required, reason, company_name, job_title, classification_status`. Applies the Section 4 filter, plus `search` (ilike over `original_recipient`/`company_name`/`job_title`) and `dateFrom`/`dateTo` (over `received_at`). Paginated, 50 rows/page.
  - `getInterviewById(id)` — same explicit column list, single row, with the Section 5 anti-tampering filter applied.
  - Both return a typed result (`{ ok: true, data }` or `{ ok: false }`) rather than throwing raw Supabase errors up to the page.
- `components/operations/FilteredEmailTable.tsx` — shared, presentational only (search box, date-range inputs, pagination controls, status-colored badges, "Not available yet" for null `company_name`/`job_title`). Takes rows + column config as props. This is the piece meant to be reused by Applications/Assessments/Offers/etc. in later projects — not built out for them now, just shaped so it can be.
- `app/(operations)/interviews/page.tsx` — thin: reads query params (search, date range, and a carried-over dashboard date filter per Section 8), calls `getInterviewRows`, renders `FilteredEmailTable`.
- `app/(operations)/interviews/[id]/page.tsx` — thin: calls `getInterviewById`, renders the "Email Metadata Details" view (see Section 7).

## 7. "Email Metadata Details" (row click target)

Renamed from "Safe Email View" — this is not the original email, only the safe, already-persisted metadata fields. No raw email body, headers, attachments, OTPs, tokens, or links are fetched or shown — none of that is stored anywhere in this system in the first place (by existing design convention: bodies are never persisted).

**Correction from the original design draft:** `sender` and `subject` are deliberately excluded. The existing dashboard data layer (`lib/zoho/cooWorkspace.ts`, `SAFE_EMAIL_COLUMNS`, line 9-29) never queries or displays either field anywhere — it uses `original_recipient` (which client mailbox a message was routed to) as its identity anchor instead. This project follows that same established convention rather than introducing raw sender/subject exposure as the first instance of it in the app. Now that `company_name`/`job_title` are persisted, they identify the row better than a raw sender address would anyway.

Fields shown: original_recipient, received date, category, confidence, priority, deadline, action_required, sanitized reason, company_name (or "Not available yet"), job_title (or "Not available yet").

## 8. Dashboard integration

The `overview` page's "Interviews" card becomes a link to `/operations/interviews`. If the dashboard currently has an active date filter, it's carried over as query params (e.g. `?from=...&to=...`) so the detail page's total matches what the user just saw on the card — never a confusing mismatch between dashboard total and detail-page total. If no dashboard date filter is active, the detail page shows all interview records (page 1).

## 9. Empty and error states

- No interview records at all → empty state, not an error.
- Filters applied but no matches → distinct "no results for these filters" state.
- Invalid or wrong-category `[id]` → not-found page (see Section 5's anti-tampering rule).
- Any Supabase failure → generic "Something went wrong loading this page" message. No raw error `.message`, no stack trace, no provider error text ever reaches the client — consistent with this repo's existing safe-logging convention (`safeError()` in `worker/index.ts`, `toBackfillErrorCode()` in `lib/zoho/backfillZohoHistory.ts`).

## 10. Testing

`vitest` coverage for `lib/zoho/operationsTable.ts`:
- The category+status filter matches the dashboard's definition exactly (Section 4).
- `search` and date-range params narrow results correctly.
- A wrong-category or dead-lettered `id` returns not-found, never the row.
- Null `company_name`/`job_title` render as "Not available yet", not blank/undefined.
- **Pagination:** page size, page navigation, and total count are all correct for the Interviews table.
- **Persistence:** the existing classifier (`classifyEmails.ts`) saves `company_name` and `job_title` for a newly classified email when the AI output contains them.

No new E2E (Playwright) test in this project — out of scope per Section 2.

## 11. Summary of data flow

```
overview dashboard "Interviews" card
  → /operations/interviews (+ carried-over date filter, if any)
  → getInterviewRows() [category='interview_invite' AND status != 'dead_letter']
  → FilteredEmailTable
  → click a row
  → /operations/interviews/[id]
  → getInterviewById() [same filter + id, anti-tampering]
  → Email Metadata Details (persisted fields only)
```
