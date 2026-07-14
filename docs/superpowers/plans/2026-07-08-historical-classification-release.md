# Historical Classification Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small, human-gated CLI tool that releases a hard-capped batch (100 rows, newest-`received_at`-first) of `historical_ingested` emails into `pending`, so the already-running live classifier processes them with zero changes to worker/sync/classify code.

**Architecture:** A new atomic Postgres function (`release_historical_batch`), modeled directly on the existing `claim_zoho_email_rows` function, does the select-lock-update in one transaction. A thin TypeScript library (`lib/zoho/releaseHistoricalBatch.ts`) calls that function via Supabase RPC and records a `zoho_release_batches` row. A CLI script exposes it via `npm run release:historical`.

**Tech Stack:** Next.js/TypeScript repo conventions already in use (Supabase service-role client, Vitest, tsx scripts).

## Global Constraints

- The release tool never touches `worker/index.ts`, `lib/zoho/syncEmails.ts`, `lib/worker-core/*`, `lib/zoho/classifyEmails.ts`, `lib/zoho/queueFoundation.ts`, `zoho_sync_checkpoints`, `zoho_backfill_checkpoints`, `middleware.ts`, or any file under `app/`.
- Batch size is capped at `100` in two independent places: a hard-coded TypeScript constant (not an env var, not a CLI flag) *and* a `least(..., 100)` clamp inside the SQL function itself, so no caller — this CLI, a future caller, or a mistake — can ever request more than 100 in one call even if the TypeScript layer were bypassed. Raising the ceiling later means changing both.
- Row order is newest `received_at` first, enforced inside the SQL function (`order by received_at desc`), not in application code.
- Dry-run is the default. A real release requires the explicit `--confirm-production-release` flag.
- The release only ever changes two fields on a row: `classification_status` (`historical_ingested` → `pending`) and `release_batch_id`. Nothing else.
- This tool never selects, reads, or logs `subject`, `sender`, `original_recipient`, email body, or any other content field — it only ever operates on `id`, `classification_status`, `received_at` (for ordering, inside SQL only), and count/aggregate values. There is nothing to scrub because nothing sensitive is ever fetched into this code path in the first place.
- No git push, no deploy, no `supabase db push`, no real (non-dry-run) invocation in this plan. Every task ends with a local commit only.

---

### Task 1: Migration — `release_batch_id` column, `zoho_release_batches` table, `release_historical_batch` function

**Files:**
- Create: `supabase/migrations/202607080002_add_release_historical_batch.sql`

**Interfaces:**
- Produces: `zoho_email_metadata.release_batch_id uuid` (nullable), `public.zoho_release_batches` table, `public.release_historical_batch(p_mailbox_email text, p_batch_id uuid, p_limit integer) returns setof uuid`. Task 2 depends on all three.

- [ ] **Step 1: Write the migration**

```sql
-- Phase: controlled historical classification release. Lets a small,
-- human-gated batch of historical_ingested rows enter the existing
-- classify queue as 'pending', tagged with which release batch moved
-- them. No change to the live worker, sync path, or classify logic.

alter table public.zoho_email_metadata
  add column release_batch_id uuid;

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

alter table public.zoho_release_batches enable row level security;

revoke all on public.zoho_release_batches from public, anon, authenticated;
grant select, insert, update, delete on public.zoho_release_batches to service_role;

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
    limit least(greatest(p_limit, 0), 100)
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

revoke all on function public.release_historical_batch(text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.release_historical_batch(text, uuid, integer)
  to service_role;
```

- [ ] **Step 2: Verify the migration is internally consistent**

Run: `cat supabase/migrations/202607080002_add_release_historical_batch.sql`
Expected: matches the RLS/grant pattern used in every other table migration in this repo (`enable row level security`, revoke from public/anon/authenticated, grant only to `service_role`) — compare against `supabase/migrations/202607070001_create_zoho_backfill_checkpoints.sql` for the identical shape.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202607080002_add_release_historical_batch.sql
git commit -m "Add release_historical_batch function and zoho_release_batches table"
```

**Do not run `supabase db push` as part of this task.** Applying this migration to production is a separate, explicit step (see the runbook in Task 4), not something to do silently mid-task.

---

### Task 2: Build `lib/zoho/releaseHistoricalBatch.ts`

**Files:**
- Create: `lib/zoho/releaseHistoricalBatch.ts`
- Create: `lib/zoho/releaseHistoricalBatch.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient` from `@/lib/supabase/server`; the `release_historical_batch` RPC function and `zoho_release_batches` table from Task 1.
- Produces (used by Task 3):
  ```typescript
  export const RELEASE_BATCH_SIZE = 100;

  export interface ReleaseOptions {
    mailbox: string;
    dryRun: boolean;
    confirmProductionRelease?: boolean;
  }

  export type ReleaseResult =
    | { ok: true; dryRun: true; eligibleCount: number }
    | { ok: true; dryRun: false; batchId: string; releasedCount: number }
    | { ok: false; code: ReleaseErrorCode };

  export type ReleaseErrorCode =
    | "RELEASE_CONFIG_INVALID"
    | "RELEASE_CONFIRMATION_REQUIRED"
    | "RELEASE_SUPABASE_FAILED"
    | "RELEASE_UNKNOWN_ERROR";

  export function optionsFromEnv(args: string[], env?: NodeJS.ProcessEnv): ReleaseOptions

  export async function runHistoricalRelease(options: ReleaseOptions): Promise<ReleaseResult>
  ```

- [ ] **Step 1: Write the failing tests**

Create `lib/zoho/releaseHistoricalBatch.test.ts`:

```typescript
import { readFileSync } from "fs";
import { resolve } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

function makeSupabase(overrides: {
  countResult?: { count: number | null; error: { message: string } | null };
  rpcResult?: { data: string[] | null; error: { message: string } | null };
  insertResult?: { error: { message: string } | null };
} = {}) {
  const countResult = overrides.countResult ?? { count: 0, error: null };
  const rpcResult = overrides.rpcResult ?? { data: [], error: null };
  const insertResult = overrides.insertResult ?? { error: null };

  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const insert = vi.fn().mockResolvedValue(insertResult);

  const from = vi.fn((table: string) => {
    if (table === "zoho_email_metadata") {
      return {
        select: () => ({
          eq: () => Promise.resolve(countResult),
        }),
      };
    }
    if (table === "zoho_release_batches") {
      return { insert };
    }
    throw new Error(`Unexpected table in test mock: ${table}`);
  });

  return { client: { rpc, from }, rpc, insert, from };
}

let mockSupabase: ReturnType<typeof makeSupabase>;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => mockSupabase.client,
}));

describe("runHistoricalRelease", () => {
  beforeEach(() => {
    mockSupabase = makeSupabase();
  });

  it("dry-run counts eligible rows and never calls the mutating RPC", async () => {
    mockSupabase = makeSupabase({ countResult: { count: 4200, error: null } });

    const { runHistoricalRelease } = await import("./releaseHistoricalBatch");
    const result = await runHistoricalRelease({ mailbox: "tracker@applywizard.ai", dryRun: true });

    expect(result).toEqual({ ok: true, dryRun: true, eligibleCount: 4200 });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(mockSupabase.insert).not.toHaveBeenCalled();
  });

  it("refuses a real release without confirmProductionRelease", async () => {
    const { runHistoricalRelease } = await import("./releaseHistoricalBatch");
    const result = await runHistoricalRelease({ mailbox: "tracker@applywizard.ai", dryRun: false });

    expect(result).toEqual({ ok: false, code: "RELEASE_CONFIRMATION_REQUIRED" });
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("calls release_historical_batch with the hard-coded 100 limit, never more", async () => {
    mockSupabase = makeSupabase({ rpcResult: { data: Array.from({ length: 100 }, (_, i) => `id-${i}`), error: null } });

    const { runHistoricalRelease, RELEASE_BATCH_SIZE } = await import("./releaseHistoricalBatch");
    await runHistoricalRelease({
      mailbox: "tracker@applywizard.ai",
      dryRun: false,
      confirmProductionRelease: true,
    });

    expect(RELEASE_BATCH_SIZE).toBe(100);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      "release_historical_batch",
      expect.objectContaining({ p_mailbox_email: "tracker@applywizard.ai", p_limit: 100 }),
    );
  });

  it("records a zoho_release_batches row with the actual released count, not the requested size", async () => {
    mockSupabase = makeSupabase({ rpcResult: { data: ["id-1", "id-2", "id-3"], error: null } });

    const { runHistoricalRelease } = await import("./releaseHistoricalBatch");
    const result = await runHistoricalRelease({
      mailbox: "tracker@applywizard.ai",
      dryRun: false,
      confirmProductionRelease: true,
    });

    expect(result.ok && !result.dryRun && result.releasedCount).toBe(3);
    expect(mockSupabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({ requested_size: 100, released_count: 3, dry_run: false }),
    );
  });

  it("maps a Supabase RPC failure to a safe error code, never the raw message", async () => {
    mockSupabase = makeSupabase({
      rpcResult: { data: null, error: { message: "relation zoho_email_metadata violates row-level security for user x@y.com" } },
    });

    const { runHistoricalRelease } = await import("./releaseHistoricalBatch");
    const result = await runHistoricalRelease({
      mailbox: "tracker@applywizard.ai",
      dryRun: false,
      confirmProductionRelease: true,
    });

    expect(result).toEqual({ ok: false, code: "RELEASE_SUPABASE_FAILED" });
  });

  it("never queries or logs subject, sender, or body fields", () => {
    const src = readFileSync(resolve(__dirname, "releaseHistoricalBatch.ts"), "utf8");
    expect(src).not.toMatch(/\bsubject\b/);
    expect(src).not.toMatch(/\bsender\b/);
    expect(src).not.toMatch(/original_recipient/);
  });
});

describe("release_historical_batch migration properties", () => {
  it("orders eligible rows newest received_at first", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202607080002_add_release_historical_batch.sql"),
      "utf8",
    );
    expect(migration).toContain("order by received_at desc");
  });

  it("only selects historical_ingested rows and locks them against concurrent release", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202607080002_add_release_historical_batch.sql"),
      "utf8",
    );
    expect(migration).toContain("classification_status = 'historical_ingested'");
    expect(migration).toContain("for update skip locked");
  });

  it("clamps the limit to 100 inside the SQL function itself, independent of the caller", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202607080002_add_release_historical_batch.sql"),
      "utf8",
    );
    expect(migration).toContain("limit least(greatest(p_limit, 0), 100)");
  });

  it("changes only classification_status and release_batch_id on release", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202607080002_add_release_historical_batch.sql"),
      "utf8",
    );
    const setClauseMatch = migration.match(/set\s+classification_status = 'pending',\s*\n\s*release_batch_id = p_batch_id,\s*\n\s*updated_at = now\(\)/);
    expect(setClauseMatch).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/zoho/releaseHistoricalBatch.test.ts`
Expected: FAIL — `Cannot find module './releaseHistoricalBatch'` (the lib file doesn't exist yet); the migration-property tests will pass already since Task 1's migration file exists.

- [ ] **Step 3: Write the implementation**

Create `lib/zoho/releaseHistoricalBatch.ts`:

```typescript
import "server-only";

import { randomUUID } from "crypto";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const RELEASE_BATCH_SIZE = 100;

export interface ReleaseOptions {
  mailbox: string;
  dryRun: boolean;
  confirmProductionRelease?: boolean;
}

export type ReleaseErrorCode =
  | "RELEASE_CONFIG_INVALID"
  | "RELEASE_CONFIRMATION_REQUIRED"
  | "RELEASE_SUPABASE_FAILED"
  | "RELEASE_UNKNOWN_ERROR";

export type ReleaseResult =
  | { ok: true; dryRun: true; eligibleCount: number }
  | { ok: true; dryRun: false; batchId: string; releasedCount: number }
  | { ok: false; code: ReleaseErrorCode };

export function optionsFromEnv(args: string[], env: NodeJS.ProcessEnv = process.env): ReleaseOptions {
  return {
    mailbox: env.ZOHO_SYNC_MAILBOX?.toLowerCase().trim() ?? "",
    dryRun: !args.includes("--confirm-production-release"),
    confirmProductionRelease: args.includes("--confirm-production-release"),
  };
}

interface SupabaseLike {
  rpc(
    fn: string,
    params: Record<string, unknown>,
  ): Promise<{ data: string[] | null; error: { message: string } | null }>;
  from(table: string): {
    select(columns: string, opts?: { count?: string; head?: boolean }): {
      eq(column: string, value: unknown): Promise<{ count: number | null; error: { message: string } | null }>;
    };
    insert(row: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
  };
}

export async function runHistoricalRelease(options: ReleaseOptions): Promise<ReleaseResult> {
  if (!options.mailbox) return { ok: false, code: "RELEASE_CONFIG_INVALID" };

  const supabase = createSupabaseServerClient() as unknown as SupabaseLike;

  if (options.dryRun) {
    const { count, error } = await supabase
      .from("zoho_email_metadata")
      .select("id", { count: "exact", head: true })
      .eq("classification_status", "historical_ingested");

    if (error) {
      console.error("[Release] Eligible-count query failed:", error.message);
      return { ok: false, code: "RELEASE_SUPABASE_FAILED" };
    }

    return { ok: true, dryRun: true, eligibleCount: count ?? 0 };
  }

  if (!options.confirmProductionRelease) {
    return { ok: false, code: "RELEASE_CONFIRMATION_REQUIRED" };
  }

  const batchId = randomUUID();

  const { data, error } = await supabase.rpc("release_historical_batch", {
    p_mailbox_email: options.mailbox,
    p_batch_id: batchId,
    p_limit: RELEASE_BATCH_SIZE,
  });

  if (error) {
    console.error("[Release] release_historical_batch RPC failed:", error.message);
    return { ok: false, code: "RELEASE_SUPABASE_FAILED" };
  }

  const releasedCount = Array.isArray(data) ? data.length : 0;

  const { error: insertError } = await supabase.from("zoho_release_batches").insert({
    id: batchId,
    mailbox_email: options.mailbox,
    requested_size: RELEASE_BATCH_SIZE,
    released_count: releasedCount,
    dry_run: false,
  });

  if (insertError) {
    console.error("[Release] Failed to record release batch:", insertError.message);
    return { ok: false, code: "RELEASE_SUPABASE_FAILED" };
  }

  return { ok: true, dryRun: false, batchId, releasedCount };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/zoho/releaseHistoricalBatch.test.ts`
Expected: PASS — all tests pass, including the migration-content assertions.

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS, all existing suites unaffected.

- [ ] **Step 6: Commit**

```bash
git add lib/zoho/releaseHistoricalBatch.ts lib/zoho/releaseHistoricalBatch.test.ts
git commit -m "Add historical release library with hard-capped batch size"
```

---

### Task 3: Build the CLI script and npm command

**Files:**
- Create: `scripts/release-historical-batch.ts`
- Modify: `package.json` (add one script entry)

**Interfaces:**
- Consumes: `optionsFromEnv`, `runHistoricalRelease`, `ReleaseResult` from Task 2.
- Produces: `npm run release:historical` (dry-run) and `npm run release:historical -- --confirm-production-release` (real).

- [ ] **Step 1: Write the script**

Create `scripts/release-historical-batch.ts`:

```typescript
import { optionsFromEnv, runHistoricalRelease } from "@/lib/zoho/releaseHistoricalBatch";

async function main() {
  const options = optionsFromEnv(process.argv.slice(2));
  const result = await runHistoricalRelease(options);

  if (!result.ok) {
    console.error(`[Release] failed code=${result.code}`);
    process.exitCode = 1;
    return;
  }

  if (result.dryRun) {
    console.log(`[Release] dry_run=true eligible_historical_ingested=${result.eligibleCount}`);
    return;
  }

  console.log(`[Release] dry_run=false batch_id=${result.batchId} released_count=${result.releasedCount}`);
}

main().catch((error: unknown) => {
  console.error(`[Release] failed code=RELEASE_UNKNOWN_ERROR`);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add this line next to the existing `"backfill:zoho"` entry:

```json
    "release:historical": "tsx scripts/release-historical-batch.ts",
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors attributable to `scripts/release-historical-batch.ts` (see Task 4 for how to distinguish new vs. pre-existing errors elsewhere).

- [ ] **Step 4: Commit**

```bash
git add scripts/release-historical-batch.ts package.json
git commit -m "Add release:historical CLI command"
```

---

### Task 4: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, zero failures, across every existing suite plus the new `releaseHistoricalBatch.test.ts`.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds; this script is not part of any Next.js route so it doesn't affect the app bundle, but the build's own TypeScript pass must still succeed.

- [ ] **Step 4: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: some pre-existing errors are known to already exist in this repo unrelated to this feature (e.g. in `lib/zoho/classifyEmails.test.ts`, `lib/zoho/backfillZohoHistory.test.ts`, `lib/classify/aiClassifier.test.ts`, `lib/zoho/cooOverview.test.ts`, `tests/operations.spec.ts` — confirmed pre-existing during the Interview Drill-Down review). If `npx tsc --noEmit` reports *any* error in a file this plan created or modified (`releaseHistoricalBatch.ts`, `releaseHistoricalBatch.test.ts`, `release-historical-batch.ts`), that is new and must be fixed before proceeding — do not wave it away as "preexisting" without checking.

- [ ] **Step 5: Confirm no forbidden scope was touched**

Run: `git diff --stat 3e43e5b..HEAD -- worker/ lib/zoho/syncEmails.ts lib/worker-core/ middleware.ts lib/zoho/classifyEmails.ts lib/zoho/queueFoundation.ts`
Expected: empty output.

- [ ] **Step 6: Confirm no content field is ever selected or logged**

Run: `grep -n "subject\|sender\|original_recipient" lib/zoho/releaseHistoricalBatch.ts scripts/release-historical-batch.ts`
Expected: no matches.

- [ ] **Step 7: Do not apply the migration, do not run a real release, do not push, do not deploy**

Confirm and report: migration file exists locally and is committed, but `supabase db push` has not been run; no `--confirm-production-release` invocation has happened against production; nothing pushed to any remote.

---

## Production runbook (for later, after this plan's commits are reviewed and approved — not part of this plan's own execution)

1. Apply the migration to production as its own explicit step: `supabase db push` (confirm it's the *only* pending migration first, same check used before every prior migration in this project).
2. Dry run first: `npm run release:historical` (no flag) — confirm it reports the eligible `historical_ingested` count and writes nothing.
3. Real release of exactly 100: `npm run release:historical -- --confirm-production-release`.
4. Monitor: `select classification_status, count(*) from zoho_email_metadata where release_batch_id = '<batch_id>' group by classification_status;` — wait until `pending`/`processing`/`retry_scheduled` are all `0` for this batch.
5. Verify: `classified + review + dead_letter = 100` exactly; `dead_letter = 0` (or investigate before proceeding further); manually spot-check a sample of newly `classified` rows' `category`/`confidence`/`company_name`/`job_title` for accuracy; confirm `/overview` dashboard cards reflect the new counts.
6. Only after all of the above succeed: consider a larger batch size, as its own separate, later, explicitly-reviewed change.
