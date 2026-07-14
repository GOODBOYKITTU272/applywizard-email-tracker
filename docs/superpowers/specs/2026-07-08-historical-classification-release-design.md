# Historical Classification Release: Design Spec

**Status:** Approved for implementation planning
**Date:** 2026-07-08

## 1. Purpose

The Zoho historical backfill (built and reviewed earlier — `lib/zoho/backfillZohoHistory.ts`, migrations `202607070001`/`202607070002`) ingested 16,426 historical emails into `zoho_email_metadata` with `classification_status = 'historical_ingested'` — a status the live classifier's claim function (`claim_zoho_email_rows`) deliberately never selects, so these rows sit safely unclassified. This project builds a small, separate, human-gated tool to release a controlled batch of these rows into the normal classification pipeline (`historical_ingested` → `pending`), so the existing live classifier processes them exactly as it processes new mail — no new classification logic, no new AI integration.

## 2. Current verified production state (2026-07-08)

- `historical_ingested`: 16,426
- `classified`: 1,527
- `review`: 232
- `pending` / `processing` / `retry_scheduled` / `dead_letter`: 0
- Live worker (Render) healthy; Interview Drill-Down feature live and healthy.

## 3. Explicitly out of scope for this project

- Hy3, DeepSeek, OpenRouter, Leads API, CA workflow/assignment, Authenticator/OTP login — all separate, later phases.
- Any change to `worker/index.ts`, `lib/zoho/syncEmails.ts`, `lib/worker-core/*`, `zoho_sync_checkpoints`, `zoho_backfill_checkpoints`, or the Zoho backfill tool itself.
- Any change to dashboard auth / `middleware.ts`.
- Any new interactive dashboard UI — existing dashboard cards (Interviews, Offers, Assessments, etc.) already count by `category`+`classification_status` live, so newly classified historical rows appear there automatically with zero UI changes.
- Automatic or scheduled release. This is a manually-triggered, human-reviewed-between-batches process only.
- Releasing more than 100 rows in a single run. Raising this ceiling requires a deliberate, separately-reviewed code change after the first 100-row batch is manually verified — not an env var an operator can bump on their own.

## 4. Data model

**New column** on `zoho_email_metadata`: `release_batch_id uuid` (nullable). Additive, no backfill of existing rows — same pattern as `company_name`/`job_title`. Lets any row be traced back to exactly which release batch (if any) moved it out of `historical_ingested`.

**New table**, `zoho_release_batches` — one row per release batch:
```sql
create table public.zoho_release_batches (
  id uuid primary key default gen_random_uuid(),
  mailbox_email text not null,
  requested_size integer not null,
  released_count integer not null default 0,
  status text not null default 'released'
    check (status in ('released', 'completed', 'failed')),
  dry_run boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
`classified_count`/`review_count`/`dead_letter_count` are deliberately **not** stored as columns on this table — they're computed on demand via `group by classification_status where release_batch_id = :id` against `zoho_email_metadata` (see Section 7). Storing them as columns would require keeping them in sync with something the asynchronous live classifier changes on its own schedule; a live query is always correct, a cached column can drift.

**New Postgres function**, `release_historical_batch(p_mailbox_email text, p_batch_id uuid, p_limit integer)` — atomic select-lock-update, modeled directly on the existing `claim_zoho_email_rows` function:
```sql
create or replace function public.release_historical_batch(
  p_mailbox_email text,
  p_batch_id uuid,
  p_limit integer
)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  with eligible as (
    select id
    from public.zoho_email_metadata
    where mailbox_email = p_mailbox_email
      and classification_status = 'historical_ingested'
    order by received_at desc
    limit greatest(p_limit, 0)
    for update skip locked
  ),
  released as (
    update public.zoho_email_metadata z
    set classification_status = 'pending',
        release_batch_id = p_batch_id,
        updated_at = now()
    from eligible
    where z.id = eligible.id
    returning z.id
  )
  select id from released;
$$;
```
Doing select+lock+update as one atomic server-side function — not two round trips from the calling script — is the same reason `claim_zoho_email_rows` already works this way in this codebase; it's the established pattern for "safely claim N rows without a race."

**Row order:** newest `received_at` first (per approved clarification #2). No other fields on a released row are touched — `claimed_by`, `attempt_count`, `next_retry_at`, etc. all stay at their existing defaults, so a released row enters the classify queue completely indistinguishably from a brand-new live row.

## 5. Release tool (mirrors the existing backfill tool's exact pattern)

- `lib/zoho/releaseHistoricalBatch.ts` — dependency-injected (same shape as `backfillZohoHistory.ts`'s `BackfillDeps`), dry-run by default. Flow: generate a new batch id client-side (`crypto.randomUUID()`) before calling the database at all → call `release_historical_batch(mailbox, batchId, limit)` via Supabase RPC, which returns the ids actually released (may be fewer than requested if fewer than 100 `historical_ingested` rows remain) → insert one `zoho_release_batches` row using that same `id`, recording `requested_size`, `released_count` (the actual count returned by the function, not the requested size), and `dry_run`. In dry-run mode, the RPC call is skipped entirely and no `zoho_release_batches` row is written — dry-run only *counts* how many `historical_ingested` rows exist to release, via a plain `select count(*)`, never calling the mutating function.
- `scripts/release-historical-batch.ts` — CLI entrypoint, same shape as `scripts/backfill-zoho-history.ts`.
- **Hard-coded batch size ceiling: 100.** Unlike the backfill tool (which clamps an env-configurable page/max-pages up to a much larger ceiling), this tool's maximum batch size is a fixed constant in code, not an operator-tunable env var — matching approved clarification #3 that raising it "requires we manually approve increasing it later" as a deliberate, reviewed code change, not something an env var typo could accidentally do.
- **Dry-run is the default** (clarification #4). Real release requires the explicit `--confirm-production-release` flag (clarification #5) — same double-gate pattern as the backfill tool: even if an env var is misconfigured, the code still refuses a real run without the explicit flag.
- **The release changes exactly two things** on selected rows: `classification_status` (`historical_ingested` → `pending`) and `release_batch_id` (clarification #6). Nothing else.

## 6. Preventing double-release

- `for update skip locked` inside `release_historical_batch` prevents two concurrent invocations from selecting the same rows.
- Once a row's `classification_status` leaves `historical_ingested` (in the same transaction as the selection), it is structurally impossible for any later call to reselect it — the function's own `where classification_status = 'historical_ingested'` clause excludes it permanently.
- The 100-row ceiling and the `--confirm-production-release` gate mean no single invocation can approach the full 16,426.

## 7. Monitoring and verification

Read-only SQL, no new dashboard UI:
```sql
select classification_status, count(*)
from zoho_email_metadata
where release_batch_id = :batch_id
group by classification_status;
```
A batch is considered settled once this query returns zero rows for `pending`, `processing`, and `retry_scheduled` (clarification #8).

**Verifying the first 100-row batch** (clarification #9), only after settlement:
1. Confirm `classified + review + dead_letter = 100` exactly — nothing missing, nothing stuck.
2. Confirm `dead_letter = 0` (or investigate any that appear before proceeding).
3. Manually spot-check a sample of newly `classified` rows' `category`/`confidence`/`company_name`/`job_title` for accuracy — this is human judgment, not automated.
4. Confirm `/overview` dashboard cards (Interviews, Offers, Assessments, Rejections, etc.) reflect the new counts — no code change needed, since those cards already count live by `category`+`classification_status`.

Only after this manual verification succeeds should batch size be considered for increase to 500 or 1,000 — and per clarification #3, that increase itself is a separate, later, explicitly-reviewed change.

## 8. Pause/resume, and the queue-ordering trade-off

Because releasing a batch is a single fast atomic operation (not a long paginated loop like the backfill), "pause" here means *the human operator chooses not to trigger the next batch* rather than a technical mid-batch interrupt — there is no clean way to stop classification partway through an already-released batch without pausing the entire live classify loop (which would also stop new live email classification). At a 100-row batch size this is not a practical concern.

**Explicit caveat (clarification #10):** `claim_zoho_email_rows` claims rows oldest-`received_at`-first. Every `historical_ingested` row has an older `received_at` than any live incoming email, so released historical rows will be claimed *ahead of* brand-new live emails in the same queue window. For a 100-row batch this means a few minutes of the classify loop working through history before returning to new mail — acceptable at this scale, called out explicitly here so it's never a surprise, and worth re-evaluating before any future increase to 500 or 1,000.

## 9. Live email safety

Zero shared code path changes: `worker/index.ts`, `lib/zoho/syncEmails.ts`, `lib/worker-core/*`, `lib/zoho/classifyEmails.ts`, `lib/zoho/queueFoundation.ts`, `zoho_sync_checkpoints`, and `zoho_backfill_checkpoints` are all untouched by this project. The only new schema surface is the one nullable column and the one new table/function described above, both purely additive. The queue-ordering trade-off in Section 8 is the one honest, non-code caveat.

## 10. Testing

`vitest` coverage for `lib/zoho/releaseHistoricalBatch.ts`:
- Dry-run writes nothing (no `historical_ingested` → `pending` transition, no `zoho_release_batches` row).
- Batch size is hard-clamped at 100 regardless of what's requested.
- Real release requires `--confirm-production-release`; without it, throws before touching the database.
- A row already `pending`, `processing`, `retry_scheduled`, `classified`, `review`, or `dead_letter` is never selected by the release query.
- Two back-to-back release calls never select the same row twice (simulated via the mock's row-state tracking, mirroring how `backfillZohoHistory.test.ts` proves live-checkpoint isolation).
- A released row has exactly `classification_status='pending'` and `release_batch_id` set — no other field changed.

## 11. Summary of flow

```
operator runs scripts/release-historical-batch.ts --confirm-production-release
  → release_historical_batch() selects up to 100 newest-received_at historical_ingested rows, atomically
  → those rows become classification_status='pending', release_batch_id=<batch>
  → zoho_release_batches row recorded (requested_size, released_count, dry_run=false)
  → the already-running live classify loop picks them up normally, no code change
  → operator waits for pending/processing/retry_scheduled = 0 for this batch
  → operator verifies classified+review+dead_letter = 100, dead_letter = 0, spot-checks accuracy, checks dashboard cards
  → only then: consider a larger batch size, as a separate future decision
```
