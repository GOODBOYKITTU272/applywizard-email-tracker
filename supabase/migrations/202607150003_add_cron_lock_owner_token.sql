-- Live Monitor V1 — Phase S2 fix: lock ownership for cron_locks.
--
-- Release must only ever delete the caller's own lock. Without ownership, a
-- process whose lock was stale-reclaimed could later delete the reclaiming
-- process's newer lock. Acquirers now store a per-run owner_token and release
-- with delete(lock_key, owner_token).
--
-- Additive and legacy-safe: the default backfills existing rows and covers
-- acquirers that do not send owner_token (lib/zoho/cronLock.ts), whose
-- key-only release semantics are unchanged.

alter table public.cron_locks
  add column owner_token text not null default gen_random_uuid()::text;
