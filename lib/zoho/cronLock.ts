import { createSupabaseServerClient } from "@/lib/supabase/server";

const LOCK_KEY = "workflow_cron";
// Reclaim locks held longer than this — covers crashed/timed-out runs.
const STALE_MINUTES = 10;

/**
 * Try to acquire the cron lock.
 * Returns true if acquired, false if another run is already active.
 * Stale locks (older than STALE_MINUTES) are reclaimed automatically.
 */
export async function acquireCronLock(): Promise<boolean> {
  const supabase = createSupabaseServerClient();
  const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();

  // Delete any stale lock first so the upsert below can succeed.
  await supabase
    .from("cron_locks")
    .delete()
    .eq("lock_key", LOCK_KEY)
    .lt("started_at", staleThreshold);

  // Insert — fails silently if an active lock already exists (PK conflict).
  const { error } = await supabase
    .from("cron_locks")
    .insert({ lock_key: LOCK_KEY, started_at: new Date().toISOString() });

  // PK violation (23505) means another run holds the lock.
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(`cron_locks insert failed: ${error.message}`);
  }
  return true;
}

/**
 * Release the cron lock. Always call in a finally block.
 */
export async function releaseCronLock(): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase.from("cron_locks").delete().eq("lock_key", LOCK_KEY);
}
