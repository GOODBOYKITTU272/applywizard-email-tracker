# Live Monitor Phase 2 — Client + Assigned CA Mapping: Design Spec

**Status:** Approved design. **Design/spec only — no code written, no build yet.**
**Date:** 2026-07-09

## 0. Scope and timing

This document is a design spec only. No implementation code is written, no app code is changed, nothing is pushed or deployed, and no Codex handoff has been created for this feature. Coding begins only after this spec is reviewed and the open questions in Section 13 are resolved.

## 1. Purpose

Phase 1 (`docs/superpowers/specs/2026-07-09-live-email-arrival-monitor-design.md`) answers "are emails arriving today." Phase 2 adds one more layer: for each mailbox that received email, *whose client is this and which CA owns it* — without turning the screen into a classification or productivity view.

## 2. What Phase 2 adds

Three new columns on the existing Phase 1 table:

| Client Mailbox | Client Name | Assigned CA | CA Email | Emails Today | Latest Email |
|---|---|---|---|---|---|
| venkat@applywizard.ai | (from Leads API) | (from Leads API) | (from Leads API) | 2 | 12:24 PM |

The last two columns (Emails Today, Latest Email) and the underlying Supabase query are unchanged from Phase 1.

## 3. Architecture

- Phase 1's `zoho_email_metadata` query stays exactly as-is — no changes to the arrival-counting logic.
- Each distinct `original_recipient` returned by that query is enriched with client/CA data from the Leads/router API, server-side, after the Supabase query returns.
- The Leads API is called **only from server-side code** (the page's server component or a server-only helper it calls). It is never called from the browser, and no Leads API credential is ever sent to or embedded in the client bundle.
- This is process-only "Loop Engineering" thinking (matching each mailbox to its lead record, one distinct value at a time, with a bounded lookup per value) — no new package, tool, or dependency is installed for it.

## 4. Leads API matching rule

Exact, case-insensitive email match only:

```
zoho_email_metadata.original_recipient.toLowerCase() === lead.email.toLowerCase()
```

No fuzzy matching, no name-based matching, no partial matching, in Phase 2 or later without a separate design decision. **Reason: a wrong CA mapping is worse than showing "Unmatched"** — this table will be read by people making real operational decisions about client coverage, and a confidently-wrong CA name is a worse failure than an honest blank.

**Known limitation, called out explicitly:** the current Leads API response has no dedicated tracker-alias field. The only fields available are `lead.name`, `lead.email`, `lead.assigned_associate.name`, `lead.assigned_associate.email`. Some leads use an `@applywizard.ai` address; others use a personal Gmail address. There is no guarantee that `original_recipient` (the tracker mailbox) equals `lead.email` for every lead — so **not every active tracker mailbox is expected to match**, and "Unmatched" rows are a normal, expected outcome of this design, not a bug signal.

## 5. Leads API lookup shape

- Targeted lookup per distinct active mailbox: `search=<email>` against the Leads API, not a full pull of the leads directory. Bounded by the number of distinct `original_recipient` values in today's result set (typically a handful of mailboxes), not by lead volume.
- A short in-memory TTL cache, ~5 minutes, keyed by mailbox email, sits in front of the lookup. This is lightweight in-process memoization only — no snapshot table, no sync job, no cron job. It resets on every server restart/redeploy, which is acceptable since it only exists to absorb the 20-second Phase-1 meta-refresh cycle re-querying the same mailboxes repeatedly.

## 6. Failure behavior

If the Leads API is down, times out, returns no match, or the match check fails for any reason:

- Client Name = `"Unmatched"`
- Assigned CA = `"Not mapped"`
- CA Email = `"-"`

**The page must still render Phase 1's email arrival data (mailbox, count, latest time) even if the Leads API call fails entirely.** A Leads API outage degrades three columns to their fallback values; it must never blank the whole table or 500 the page. This is the same fail-open-to-fallback-values pattern the failure list below assumes throughout.

## 7. Timeout

Server-side lookups to the Leads API use a short timeout, ~3–5 seconds, per distinct mailbox. A slow Leads API must not stall the page — a timed-out lookup resolves to the Section 6 fallback values for that mailbox and the page renders on schedule.

## 8. Security and privacy

- Leads API credentials (Basic Auth) are Vercel environment variables only — never hardcoded, never committed, never included in this spec with real values.
- The Leads API response body is never logged. Raw errors are never logged (log a generic failure marker only, e.g. "leads lookup failed" — no response body, no auth header, no stack trace containing the request).
- The Basic Auth header is constructed server-side from env vars and never exposed to the client bundle or sent to the browser.
- **This phase introduces client PII to this screen for the first time** — Phase 1 was deliberately the narrowest-footprint screen in the app (mailbox + timestamp only, Section 6/13 of the Phase 1 spec). Phase 2 now displays client name and CA name/email. This is a real, intentional increase in data sensitivity and should be treated as such in review, not waved through because it "just adds a couple of columns."

## 9. Environment variables to document later (no real values — placeholders only)

- `LEADS_API_BASE_URL`
- `LEADS_API_BASIC_AUTH` — or separate `LEADS_API_USERNAME` / `LEADS_API_PASSWORD`, whichever is safer for the implementation (decide at build time; not decided in this spec)

## 10. Files likely needing changes later (documented only — no code written now)

- New: `lib/leadsApi/getLeadByEmail.ts` — targeted `search=<email>` lookup, TTL cache, timeout, auth header construction, generic-error fallback.
- Modify: `lib/zoho/emailArrival.ts` — after the Phase 1 query, enrich each row via `getLeadByEmail`.
- Modify: `app/(operations)/live-monitor/email-arrival/page.tsx` — render the three new columns.
- Modify: `.env.example` — add Section 9's variables with placeholder values only.
- Tests: exact match, unmatched (no lead found), API error, timeout, and cache-hit/expiry behavior.

## 11. Explicitly out of scope for Phase 2

Classification counts, interviews count, assessments count, offers count, rejections count, the "25 jobs" target, manager productivity, Human Review integration, Hy3, DeepSeek, OpenRouter, Live Feed, WebSockets, client-side polling, fuzzy matching, name-based matching, partial matching, a persistent cache table, a sync job, a cron job.

## 12. Auth

No change to `middleware.ts` — `/live-monitor` and `/live-monitor/:path*` are already in `PROTECTED_PATHS` and `config.matcher` from Phase 1. No new route is introduced by Phase 2.

## 13. Open questions before coding

1. **Auth mechanism (resolved):** the Leads API uses HTTP Basic Auth. Real credentials must never go into code or into this spec — they are supplied later via `LEADS_API_BASIC_AUTH` (or separate username/password env vars) at implementation time.
2. **Env var shape:** single combined `LEADS_API_BASIC_AUTH` vs. separate username/password vars — left for the implementer to decide based on how the credential is issued.
3. **Operational note, not a spec item:** the Leads API password has been pasted in plaintext multiple times during this design discussion. It should be rotated before Phase 2 is actually implemented against production, independent of anything in this document.
