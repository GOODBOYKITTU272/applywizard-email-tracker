-- Concurrency lock for the workflow cron.
-- Only one row per lock_key may be active at a time.
-- started_at lets stale locks (crashed runs) be reclaimed after STALE_LOCK_MINUTES.

create table if not exists public.cron_locks (
  lock_key   text primary key,
  started_at timestamptz not null default now()
);
