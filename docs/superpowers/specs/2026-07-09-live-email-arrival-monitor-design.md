# Live Email Arrival Monitor — Phase 1: Design Spec

**Status:** Approved design. **Design/spec only — no code written, no build yet.**
**Date:** 2026-07-09

## 0. Scope and timing

This document is a design spec only. Implementation does not begin until Human Review + Safe Email Preview is fully reviewed and closed out. No Codex handoff has been created for this feature yet.

## 1. Purpose

Before checking classification accuracy or CA productivity, the capture team needs a simple, real-time answer to one question: **are emails arriving into the tracker mailbox today, or not?** This is a new, standalone screen answering only that question — not a classification view, not a productivity view, not CA tracking.

## 2. Route

`/live-monitor/email-arrival`, following the existing `app/(operations)/` route-group convention (same structural pattern as `app/(operations)/operations/interviews/`).

## 3. Sidebar

Add **"Live Monitor"** as a flat sidebar link directly to `/live-monitor/email-arrival` for Phase 1. Do not build an expandable submenu yet — the existing `NavLink` component (`app/(operations)/layout.tsx:42`) is a flat link with no precedent anywhere in this app for a nested/expandable nav item. Building that UI now, for a single Phase-1 child screen, would be premature. A real submenu (Email Arrival + Live Feed) becomes worth building once "Live Feed" exists as a second child screen.

This spec adds exactly one new nav item. For context, the eventual target sidebar (from the broader product plan, not all built yet) is:
```
Overview
Live Monitor        (new in this spec — flat link to /live-monitor/email-arrival)
Clients
Operations
Review Queue
Reports             (does not exist yet — not part of this spec)
Settings            (does not exist yet — not part of this spec)
```

## 4. Auth protection — mandatory, non-negotiable

`/live-monitor` is a brand-new top-level path. It is currently **not** present anywhere in `middleware.ts`'s `PROTECTED_PATHS` array or `config.matcher` array. Adding both `/live-monitor` and `/live-monitor/:path*` to these lists is a **hard requirement** of this feature, called out explicitly because this exact class of mistake — a new route silently uncovered by the auth matcher — caused a real, live, unauthenticated-exposure incident during the Interview Drill-Down rollout. No public exposure of this route is acceptable under any circumstance. The implementation plan for this feature must include an explicit test proving the route requires auth, not just a manual reminder.

## 5. Phase 1 screen contents

**Title:** Live Email Arrival Monitor
**Subtitle:** Real-time view of emails arriving in tracker today (12:00 AM – 11:59 PM IST)

**Top cards:**
1. Total Emails Today
2. Latest Email Time
3. Active Mailboxes Today
4. Silent Mailboxes Today — shows **"Not tracked yet"** for Phase 1. This app has no stored roster of expected/active client mailboxes to compare against (confirmed: no real `clients` table exists in Supabase; client data today lives only in `lib/mockData.ts`, which is mock-only). Without a real roster, "silent" cannot be computed even approximately — showing "0" would misleadingly imply "confirmed zero silent mailboxes" rather than "we don't have this data yet." "Not tracked yet" is the honest state.

**Main table: Email Arrival by Client Mailbox**

| Client Mailbox | Emails Today | Latest Email |
|---|---|---|
| venkat@applywizard.ai | 2 | 12:24 PM |
| sasi@applywizard.ai | 1 | 12:08 PM |
| jagan@applywizard.ai | 1 | 12:01 PM |

## 6. Data source — explicit fields only

Reads only two columns from `zoho_email_metadata`:
- `original_recipient` (client mailbox identity — the same field already used throughout this dashboard, e.g. `lib/zoho/cooWorkspace.ts`'s `SAFE_EMAIL_COLUMNS`, chosen deliberately over `sender` for the same privacy reasons established during the Interview Drill-Down review)
- `received_at`

**Explicitly does not use:** `subject`, `sender`, email body, `category`, `classification_status`, any AI output field, the ApplyWizz Leads API, or any router/routing API. This is the narrowest data footprint of any dashboard screen built so far.

## 7. Date logic — true IST calendar day

"Today" means true IST midnight-to-midnight (12:00 AM – 11:59 PM IST), computed as UTC+5:30 offset boundaries converted to UTC for the query.

**This is deliberately a new, separate boundary calculation — not a modification to the existing shared `resolveDateRange` function in `lib/zoho/cooWorkspace.ts`.** That function's existing UTC-calendar-day behavior is used by other screens (`getOverviewWorkspaceData`, `getOverviewDashboardData`) that may depend on its current behavior; changing it to IST would silently shift what "today" means everywhere else on the dashboard. This screen gets its own small, purpose-built IST-boundary helper instead.

## 8. Query logic

```sql
select original_recipient, count(*) as emails_today, max(received_at) as latest_email
from zoho_email_metadata
where received_at >= :ist_start_of_today_in_utc
  and received_at <= :ist_end_of_today_in_utc
  and original_recipient is not null
group by original_recipient
order by latest_email desc;
```
- `Total Emails Today` = sum of `emails_today` across all groups.
- `Latest Email Time` (top card) = `max(received_at)` across the full result set.
- `Active Mailboxes Today` = count of distinct `original_recipient` values in the result set.

## 9. Empty state

Exactly, when the query returns zero rows:
> "No emails received today."
> "No tracker emails have been received since 12:00 AM today."

Uses the existing `EmptyState` component (`components/coo.tsx`) already used elsewhere in the dashboard.

## 10. Refresh behavior

**`<meta httpEquiv="refresh" content="20">`** — a plain HTML meta-refresh tag, not client-side polling and not a websocket. Verified: no auto-refresh or polling pattern exists anywhere in this app today — every page is a plain server component re-fetched only on navigation or manual reload. A meta-refresh tag achieves 20-second auto-refresh with zero new JavaScript and zero new client/server boundary, fully consistent with the app's current 100%-server-rendered convention. A `setInterval` + `router.refresh()` client component would be this app's *first* client-side polling pattern — more moving parts for the same practical outcome, and explicitly out of scope for Phase 1 unless later required.

## 11. Files likely needing changes later (documented only — no code written now)

- `middleware.ts` — add `/live-monitor` and `/live-monitor/:path*` (Section 4).
- `app/(operations)/layout.tsx` — one new `NavLink` entry, across all three existing nav render sites (desktop sidebar, mobile menu, mobile bottom nav).
- `app/(operations)/live-monitor/email-arrival/page.tsx` — new.
- `lib/zoho/emailArrival.ts` — new; IST-day boundary helper + the grouped query + aggregate totals.
- Tests: auth-protection test for the new route (Section 4), and query-logic tests for the grouping/counting/sorting behavior (Section 8).

## 12. Explicitly out of scope for Phase 1

Classification counts (Classified, Review, Applications, Interviews, Assessments, Offers, Rejections — all deferred to Phase 2), CA name, manager name, the "25 jobs" target, the ApplyWizz Leads API, any router API, Human Review integration, Hy3, DeepSeek, OpenRouter, the "Live Feed" screen, and the expandable sidebar submenu.

## 13. Security/privacy

Lower data-risk than any prior dashboard feature: only `original_recipient` (mailbox identity) and `received_at` (timestamp) are ever read or displayed — no body, subject, sender, message ID, or AI output anywhere. No mutation of any kind (read-only screen). No `select("*")` — explicit column list only, matching the established convention for every prior feature in this project. The one new auth surface (Section 4) closes a gap rather than opening one, and must be verified with an explicit test before this ships.

## 14. Open questions for whoever builds this later

None outstanding — all design decisions in this document were explicitly confirmed before writing. The only judgment call surfaced during design (IST vs. UTC "today" boundary) was resolved in favor of true IST (Section 7).
