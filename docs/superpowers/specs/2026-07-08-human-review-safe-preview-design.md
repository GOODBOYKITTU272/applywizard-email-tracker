# Human Review + Safe Email Preview: Design Spec

**Status:** Approved for implementation planning
**Date:** 2026-07-08

## 1. Purpose

Today, `/operations/interviews/[id]` ("Email Metadata Details") shows only classifier metadata — category, confidence, priority, deadline, action_required, reason. That's not enough to judge whether an AI classification is actually correct. This project adds:
1. A safe, redacted preview of the actual email content, fetched live from Zoho — not stored anywhere.
2. Three human review actions: confirm the category, change it, or defer to review.
3. An audit trail (who/when/what changed), with the AI's original category permanently preserved.
4. Dashboard counts updated to reflect the human-corrected category, everywhere counts already exist.

This is a foundational step toward later using human corrections to measure and improve AI accuracy (Hy3/DeepSeek comparison) — not built in this project.

## 2. Explicitly out of scope for this project

- Hy3, DeepSeek, OpenRouter — no integration, no comparison logic. Human corrections are simply recorded for now.
- The Leads API, CA workflow/assignment, Authenticator/OTP login.
- Any change to the live worker, sync path, classify pipeline logic, or either checkpoint table.
- Any change to the historical classification release tool or its logic.
- Storing the email preview anywhere. It is fetched, redacted, rendered, and discarded on every view — never written to Supabase.
- Attachments — never fetched, never listed.
- A "list view" of pending human reviews across all rows (this project only adds the review UI to the existing single-row detail page).

## 3. Current verified facts (grounding this design in reality, not assumption)

- **No raw email body is stored anywhere.** Confirmed via full column audit of every `zoho_email_metadata` migration, and via the code's own comment (`lib/zoho/classifyEmails.ts:336`, `:604`): *"bodyText is used for classification only — never stored or logged."* Body is fetched transiently from Zoho's `/content` endpoint per classification, used once, discarded.
- **No preview/snippet column exists.** `subject` is stored but — per the established convention confirmed during the Interview Drill-Down review — never displayed in this dashboard.
- **A redaction utility already exists**: `lib/classify/sanitizeReason.ts`, with regex patterns for URLs, emails, OTP-shaped 4-8 digit codes, 24+ char tokens, password/secret markers, and quoted strings. Built for short AI-reason text (160 char input cap, single-sentence fallback) — this project reuses its *patterns*, not the function itself, since a body preview is longer-form and shouldn't collapse to one generic sentence the way a reason does.
- **`/api/*` routes are not covered by the Basic Auth middleware at all.** `PROTECTED_PATHS`/`config.matcher` in `middleware.ts` only list `/dashboard`, `/overview`, `/clients`, `/operations`, `/review-queue`. This is why Section 6 recommends a Server Action over a new API route.
- **The real `EmailCategory` enum has 13 values** (`lib/classify/types.ts`): `application_received`, `assessment`, `interview_invite`, `rejection`, `job_offer`, `recruiter_reply`, `follow_up_needed`, `otp_verification`, `email_verification`, `account_created`, `system_notification`, `spam_or_irrelevant`, `unknown`. All 13 are included in the correction picker (per approved clarification).

## 4. Data model

Four new nullable columns on `zoho_email_metadata`:
```sql
alter table public.zoho_email_metadata
  add column human_category text,
  add column reviewed_by text,
  add column reviewed_at timestamptz,
  add column correction_reason text;
```
Additive, nullable, no backfill, no existing column touched — same pattern as every prior migration in this project.

**`category` is never overwritten.** It remains the AI's original call, permanently, for audit purposes. `human_category` is null until a human acts on that row. This is the full audit trail: "what AI said" (`category`, `confidence`, `classifier_source`, `reason` — all already existing) vs. "what a human decided" (`human_category`, `reviewed_by`, `reviewed_at`, `correction_reason` — new).

**Three actions, three effects:**
| Action | `human_category` | `classification_status` | `reviewed_by`/`reviewed_at` |
|---|---|---|---|
| "Yes, this is Interview" (confirm) | set equal to `category` | → `classified` | set |
| "No, change category" | set to the picked value | → `classified` | set |
| "Send to Review" | left null | → `review` | set |

`correction_reason` is optional free text, only meaningful on a "change category" action, redacted the same way as everything else (Section 5).

## 5. Safe preview: fetch, redact, discard — never stored

**Architecture:** `lib/zoho/emailPreview.ts` — a new function, `getSafeEmailPreview(row)`, that:
1. Looks up the row's Zoho connection/access token and refreshes it if expired.
2. Fetches raw content from Zoho's `/content` endpoint for that message.
3. Strips HTML the same way `classifyEmails.ts` already does.

**Correction caught during self-review:** both `refreshZohoToken` (line 130) and `stripHtml` (line 114) in `classifyEmails.ts` are private, non-exported functions — neither can be imported as-is by a new file. The implementation plan must either export both from `classifyEmails.ts`, or extract them into a small shared helper module both files import. Duplicating this logic inline in a second file is the one option to avoid: two independent copies of token-refresh or HTML-stripping logic is exactly the kind of drift that causes bugs later when only one copy gets fixed.
4. Applies redaction: the same regex patterns as `sanitizeReason.ts` (URL → `[redacted-url]`, email → `[redacted-email]`, OTP-shaped code → `[redacted-code]`, long token → `[redacted-token]`, password/secret markers → `[redacted-marker]`), extracted into a small shared helper both files import, rather than duplicated.
5. Truncates to a reasonable preview length (e.g. 2000 characters) — long enough to judge intent, not a full-document dump.
6. Returns the redacted text directly to the page. **Nothing is written to Supabase.** Nothing is logged. If the fetch fails, the page shows "Preview unavailable" — never a raw provider error.

**Why on-demand instead of stored** (per approved clarification): storing even a redacted preview would still mean new permanent at-rest storage of real email content — a data-retention posture this app has never had. Fetching live and discarding keeps the one consistent principle intact across every feature built so far: raw body is never persisted, anywhere. It also covers all 16,426+ already-classified rows immediately, which a stored-preview approach could never do (it would only apply to emails classified after the column existed — the exact same limitation `company_name`/`job_title` already have).

**Rendering safety:** the preview is rendered as plain text only. Never `dangerouslySetInnerHTML`. This also means tracking-pixel `<img>` tags are stripped along with everything else — incidental privacy benefit, not just a safety requirement.

## 6. The save action: a Server Action, not a new API route

This is this app's first-ever mutation triggered from the dashboard UI (every prior dashboard feature has been read-only). The save action (confirm / change / send-to-review) is implemented as a Next.js Server Action (`"use server"`) co-located in `/operations/interviews/[id]/page.tsx`, not a separate `/api/*` route.

**Why this matters, concretely:** a Server Action defined inside a page is invoked via POST to that same page's route. `/operations/interviews/[id]` is already covered by the existing `/operations/:path*` middleware matcher. A new standalone API route would need its own, manually-added matcher entry — which is exactly the class of mistake (a route silently uncovered by the auth matcher) that caused a real, live, unauthenticated-exposure incident earlier this same day during the Interview Drill-Down deploy. Using a Server Action here means there is no new auth surface to get wrong.

**Anti-tampering on save:** the Server Action must re-verify (via `getInterviewById`-equivalent logic: `id` + `category = 'interview_invite'` + `classification_status != 'dead_letter'`) that the row is still a legitimate, in-scope row before writing — not trust a client-submitted id blindly, matching the same discipline already applied to the read path.

## 7. Dashboard count changes (included in this project, per approved clarification)

Every existing count in `lib/zoho/cooWorkspace.ts` (Interviews, Offers, Assessments, Rejections, Recruiter Replies, Applications, Follow-up Needed — all of them) currently checks `row.category === 'interview_invite'` (etc.) directly. All of these change to check the *effective* category: `coalesce(human_category, category)`. This is the same one-line pattern repeated at each of the ~7-10 call sites in that file — mechanically simple, but touches the widest surface of any change in this project, so it's called out as its own section rather than buried in "components."

Without this change, a human correction would update the row but never actually fix what the dashboard shows — which is the stated goal of this feature, not an optional add-on.

## 8. Routes/components touched

- `app/(operations)/operations/interviews/[id]/page.tsx` — add: preview section (Section 5), three review buttons, conditional 13-item category picker (shown only after "No, change category" is clicked), the Server Action (Section 6).
- `lib/zoho/emailPreview.ts` — new (Section 5).
- `lib/zoho/operationsTable.ts` — `getInterviewById`'s explicit column list gains `human_category`, `reviewed_by`, `reviewed_at`, `correction_reason`.
- `lib/zoho/cooWorkspace.ts` — the coalesce change (Section 7), at every existing category-count site.
- No new routes, no new pages beyond what already exists.

## 9. Security summary

- Preview: never stored, rendered as plain text only (no HTML injection risk), redacted via the same patterns already trusted for AI-reason text, truncated to a bounded length.
- Save action: Server Action inheriting existing, already-verified middleware coverage (no new auth surface); re-validates the row before writing (anti-tampering, same discipline as the read path).
- No new logging of raw content anywhere — preview fetch failures produce a fixed "Preview unavailable" message, never a raw provider error.
- `correction_reason` (human-entered free text) is redacted with the same pattern set as `reason`, since a human typing a note could just as easily paste something sensitive as an AI could generate it.

## 10. Testing

`vitest` coverage for `lib/zoho/emailPreview.ts`:
- Redaction: a synthetic body containing a URL, an email address, a 6-digit code, a 32-char token, and the word "password" all get replaced with their respective `[redacted-x]` markers, and none of the raw values appear in the output.
- Truncation: a body longer than the cap is cut to the cap, not silently dropped or errored.
- Fetch failure returns a fixed "Preview unavailable" result, never the raw error.

`vitest` coverage for the Server Action / save logic:
- Confirm ("Yes"): `human_category` set equal to `category`, `classification_status` → `classified`.
- Change category: `human_category` set to the picked value, `classification_status` → `classified`.
- Send to review: `classification_status` → `review`, `human_category` left null.
- Anti-tampering: an id belonging to a non-interview category or a `dead_letter` row is rejected, never written.
- `correction_reason` is redacted the same way as `reason`.

`vitest` coverage for `lib/zoho/cooWorkspace.ts`:
- A row with `human_category` set is counted under the corrected category, not the original AI category, at every affected count site.

## 11. Summary of flow

```
/operations/interviews/[id] loads
  → getInterviewById() [unchanged filter, now also selects human_category/reviewed_by/reviewed_at/correction_reason]
  → getSafeEmailPreview() [fetch from Zoho, strip HTML, redact, truncate — never stored]
  → render metadata + preview + 3 buttons

human clicks a button
  → Server Action (same page route, already-covered by middleware)
  → re-verify row is still in-scope (anti-tampering)
  → write human_category / reviewed_by / reviewed_at / correction_reason / classification_status
  → category column (AI's original call) untouched, forever

dashboard counts
  → coalesce(human_category, category) at every existing count site
  → corrected rows now show up under their human-decided category
```
