# Interview Dashboard Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Interviews" dashboard card clickable, opening a real, filtered, paginated list of interview-related emails backed by Supabase, with a read-only detail view per row.

**Architecture:** A new Supabase-backed query module (`lib/zoho/operationsTable.ts`) feeds a thin server-rendered list page (`/operations/interviews`) built on a new shared, presentational table component (`FilteredEmailTable`), plus a thin detail page (`/operations/interviews/[id]`). Two new nullable columns (`company_name`, `job_title`) are added to `zoho_email_metadata` and wired into the existing classifier's persistence call so future classifications save data the AI already computes today but currently discards.

**Tech Stack:** Next.js App Router (server components), Supabase (Postgres + supabase-js), TypeScript, Vitest.

## Global Constraints

- Never query or display `sender` or `subject`. Use `original_recipient` instead, matching the existing `SAFE_EMAIL_COLUMNS` convention in `lib/zoho/cooWorkspace.ts`.
- Never modify `historical_ingested` rows, already-`classified` rows, or already-`review` rows. No reclassification, no backfill, in this plan.
- Do not modify `worker/index.ts`, `lib/zoho/syncEmails.ts`, `lib/worker-core/*`, `zoho_sync_checkpoints`, `zoho_backfill_checkpoints`, or `middleware.ts`.
- The Interview filter is exactly `category = 'interview_invite' AND classification_status != 'dead_letter'` everywhere it appears (query, tests, anti-tampering check) — must match `lib/zoho/cooWorkspace.ts` line ~583 exactly, never redefined independently.
- Never use `select("*")`. Every Supabase query lists its columns explicitly.
- Never let a raw Supabase/provider error message reach the browser. Server-side `console.error` logging of `error.message` is fine (existing convention in `cooWorkspace.ts`); user-facing text must always be a fixed, generic string.
- `vitest.config.ts` only picks up `lib/**/*.test.ts` and `worker/**/*.test.ts`. Components and page files (`components/**`, `app/**`) are not unit-tested in this repo today — do not add a test file there; this plan doesn't introduce new test infrastructure.
- No git push, no deploy, no Vercel/Render action in this plan. Every task ends with a local commit only.

---

### Task 1: Migration — add `company_name` and `job_title` columns

**Files:**
- Create: `supabase/migrations/202607080001_add_company_job_title_to_email_metadata.sql`

**Interfaces:**
- Produces: two new nullable columns, `company_name text` and `job_title text`, on `public.zoho_email_metadata`. Task 2 and Task 3 both depend on these columns existing.

- [ ] **Step 1: Write the migration**

```sql
-- Phase: Interview drilldown. Persists company_name/job_title that the
-- classifier already computes today but discards before saving. Additive,
-- nullable, no backfill of existing rows.
alter table public.zoho_email_metadata
  add column company_name text,
  add column job_title text;
```

- [ ] **Step 2: Verify the migration file is syntactically consistent with existing migrations**

Run: `cat supabase/migrations/202607080001_add_company_job_title_to_email_metadata.sql`
Expected: matches the additive, no-backfill pattern used in `supabase/migrations/202607070002_allow_historical_ingested_status.sql` (comment explaining why, then a single `alter table`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202607080001_add_company_job_title_to_email_metadata.sql
git commit -m "Add company_name/job_title columns to zoho_email_metadata"
```

**Do not run `supabase db push` as part of this task.** Applying the migration to the connected production project is a separate, explicit step outside this plan (same pattern as the backfill migrations earlier in this project) — call it out when this plan reaches execution, don't apply it silently mid-task.

---

### Task 2: Persist `company_name`/`job_title` in the live classifier

**Files:**
- Modify: `lib/zoho/classifyEmails.ts:662-676` (the `updateClaimedEmail` payload inside the live, non-dry-run classify loop)
- Modify: `lib/zoho/classifyEmails.test.ts` (add one test to the existing `describe("write-back field contract", ...)` block, and one to the existing end-to-end persistence test)

**Interfaces:**
- Consumes: `classification.company_name`, `classification.job_title` — both already exist on `ClassificationResult` (`lib/classify/types.ts:45-46`), nothing to add there.
- Produces: the `updateClaimedEmail` payload now includes `company_name` and `job_title` keys. Task 3's `getInterviewRows`/`getInterviewById` select these same columns and depend on them being populated going forward.

- [ ] **Step 1: Write the failing contract test**

Add this test inside the existing `describe("write-back field contract", ...)` block in `lib/zoho/classifyEmails.test.ts` (near the other payload-shape tests, e.g. right after `"body text is not present in the write-back payload"`):

```typescript
    it("includes company_name and job_title in the write-back payload when present", () => {
      const payload: Record<string, unknown> = {
        category: "interview_invite",
        confidence: 0.93,
        classifier_source: "ai",
        classification_status: "classified",
        company_name: "State Farm",
        job_title: "Data Analyst",
      };
      mockSupabaseUpdate(payload);
      expect(mockSupabaseUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ company_name: "State Farm", job_title: "Data Analyst" }),
      );
    });
```

Also add this real end-to-end test, mirroring the existing `"sanitizes unsafe AI reasons before the live persistence update"` test in the same file (same mailbox/env setup, same `fetchMock` shape) — place it directly after that test:

```typescript
    it("persists company_name and job_title from AI output on the live path", async () => {
      process.env.ZOHO_SYNC_MAILBOX = "test@applywizard.ai";
      process.env.ZOHO_CLIENT_ID = "cid";
      process.env.ZOHO_CLIENT_SECRET = "secret";
      process.env.ZOHO_ACCOUNTS_BASE_URL = "https://accounts.zoho.test";
      process.env.ZOHO_MAIL_BASE_URL = "https://mail.zoho.test";
      process.env.ZOHO_CLASSIFY_MAX_PER_RUN = "5";

      mockClaimEmailsForClassification.mockResolvedValue([
        {
          id: "row-2",
          message_id: "msg-2",
          folder_id: "fold-1",
          sender: "sender@company.test",
          received_at: "2026-06-30T04:00:00.000Z",
          attempt_count: 0,
        },
      ]);
      mockUpdateClaimedEmail.mockResolvedValue(true);
      mockClassifyEmail.mockReturnValue({
        ...BASE_RESULT,
        category: "unknown",
        confidence: 0.2,
        needs_human_review: true,
      });
      mockTryRegexExtract.mockReturnValue(null);
      mockClassifyWithAI.mockResolvedValue({
        ...BASE_RESULT,
        category: "interview_invite",
        confidence: 0.9,
        needs_human_review: false,
        company_name: "State Farm",
        job_title: "Data Analyst",
      });

      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/details")) {
          return {
            ok: true,
            json: async () => ({
              status: { code: 200, description: "success" },
              data: {
                messageId: "msg-2",
                sender: "sender@company.test",
                fromAddress: "sender@company.test",
                subject: "Interview invitation",
                receivedTime: "1719043200000",
                toAddress: "tracker@applywizard.ai",
              },
            }),
          };
        }
        if (url.includes("/content")) {
          return {
            ok: true,
            json: async () => ({
              status: { code: 200, description: "success" },
              data: { messageId: "msg-2", content: "<p>Generic safe body</p>" },
            }),
          };
        }
        if (url.includes("/header?raw=true")) {
          return {
            ok: true,
            json: async () => ({
              status: { code: 200, description: "success" },
              data: { headerContent: "Delivered-To: tracker@applywizard.ai" },
            }),
          };
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      });

      const originalFetch = global.fetch;
      global.fetch = fetchMock as typeof fetch;

      try {
        const { classifyEmails } = await import("@/lib/zoho/classifyEmails");
        await classifyEmails();
      } finally {
        global.fetch = originalFetch;
      }

      const persistenceCall = mockUpdateClaimedEmail.mock.calls.find(
        ([, args]) => args?.payload?.company_name !== undefined,
      );

      expect(persistenceCall?.[1]?.payload?.company_name).toBe("State Farm");
      expect(persistenceCall?.[1]?.payload?.job_title).toBe("Data Analyst");
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/zoho/classifyEmails.test.ts`
Expected: FAIL — both new tests fail because `company_name`/`job_title` are not yet in the payload (the `toHaveBeenCalledWith`/`toBe` assertions fail since the real payload omits these keys).

- [ ] **Step 3: Add the two fields to the live persistence payload**

In `lib/zoho/classifyEmails.ts`, find the `updateClaimedEmail(...)` call's `payload` object (around line 662-676, immediately after `priority: (classification as { priority?: string }).priority ?? null,`). Add two lines:

```typescript
            priority: (classification as { priority?: string }).priority ?? null,
            company_name: (classification as { company_name?: string | null }).company_name ?? null,
            job_title: (classification as { job_title?: string | null }).job_title ?? null,
            reason: safeReason,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/zoho/classifyEmails.test.ts`
Expected: PASS — all tests in the file pass, including the two new ones.

- [ ] **Step 5: Run the full existing test suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS — all existing suites (backfill, sync, queue, workspace, etc.) still pass; this change only adds two keys to one payload object.

- [ ] **Step 6: Commit**

```bash
git add lib/zoho/classifyEmails.ts lib/zoho/classifyEmails.test.ts
git commit -m "Persist company_name/job_title from AI classification output"
```

---

### Task 3: Build `lib/zoho/operationsTable.ts` — interview query helpers

**Files:**
- Create: `lib/zoho/operationsTable.ts`
- Create: `lib/zoho/operationsTable.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServerClient` from `@/lib/supabase/server` (same client `cooWorkspace.ts` uses); `company_name`/`job_title` columns from Task 1.
- Produces (used by Task 5 and Task 6):
  ```typescript
  export const INTERVIEWS_PAGE_SIZE = 50;

  export interface InterviewRow {
    id: string;
    original_recipient: string | null;
    received_at: string | null;
    category: string | null;
    confidence: number | null;
    priority: string | null;
    deadline: string | null;
    action_required: string | null;
    reason: string | null;
    company_name: string | null;
    job_title: string | null;
    classification_status: string | null;
  }

  export interface InterviewFilters {
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
  }

  export type GetInterviewRowsResult =
    | { ok: true; rows: InterviewRow[]; totalCount: number; page: number; pageSize: number }
    | { ok: false };

  export async function getInterviewRows(filters?: InterviewFilters): Promise<GetInterviewRowsResult>

  export type GetInterviewByIdResult =
    | { ok: true; row: InterviewRow }
    | { ok: false };

  export async function getInterviewById(id: string): Promise<GetInterviewByIdResult>
  ```

- [ ] **Step 1: Write the failing tests**

Create `lib/zoho/operationsTable.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type MockRow = Record<string, unknown>;

function applyFilters(rows: MockRow[], filters: Array<{ type: string; column: string; value: unknown }>) {
  return rows.filter((row) =>
    filters.every((filter) => {
      const value = row[filter.column];
      if (filter.type === "eq") return value === filter.value;
      if (filter.type === "neq") return value !== filter.value;
      if (filter.type === "gte") return String(value ?? "") >= String(filter.value ?? "");
      if (filter.type === "lte") return String(value ?? "") <= String(filter.value ?? "");
      if (filter.type === "or") {
        const clauses = String(filter.value).split(",");
        return clauses.some((clause) => {
          const [col, , pattern] = clause.split(".");
          const term = String(pattern ?? "").replace(/%/g, "").toLowerCase();
          return String(row[col] ?? "").toLowerCase().includes(term);
        });
      }
      return true;
    }),
  );
}

function createSupabaseMock(rows: MockRow[]) {
  const makeQuery = () => {
    const state = {
      filters: [] as Array<{ type: string; column: string; value: unknown }>,
      range: null as null | { start: number; end: number },
      single: false,
    };

    const query: Record<string, unknown> = {
      eq(column: string, value: unknown) {
        state.filters.push({ type: "eq", column, value });
        return query;
      },
      neq(column: string, value: unknown) {
        state.filters.push({ type: "neq", column, value });
        return query;
      },
      gte(column: string, value: unknown) {
        state.filters.push({ type: "gte", column, value });
        return query;
      },
      lte(column: string, value: unknown) {
        state.filters.push({ type: "lte", column, value });
        return query;
      },
      or(value: string) {
        state.filters.push({ type: "or", column: "", value });
        return query;
      },
      range(start: number, end: number) {
        state.range = { start, end };
        return query;
      },
      maybeSingle() {
        state.single = true;
        return query;
      },
      then(resolve: (value: { data: MockRow[] | MockRow | null; error: null; count?: number }) => void) {
        const filtered = applyFilters(rows, state.filters);
        if (state.single) {
          resolve({ data: filtered[0] ?? null, error: null });
          return;
        }
        const ranged = state.range ? filtered.slice(state.range.start, state.range.end + 1) : filtered;
        resolve({ data: ranged, error: null, count: filtered.length });
      },
    };
    return query;
  };

  return {
    from: () => ({
      select: () => makeQuery(),
    }),
  };
}

const INTERVIEW_ROW = (overrides: MockRow = {}): MockRow => ({
  id: "row-1",
  original_recipient: "client@applywizard.ai",
  received_at: "2026-07-01T00:00:00.000Z",
  category: "interview_invite",
  confidence: 0.9,
  priority: "high",
  deadline: null,
  action_required: null,
  reason: null,
  company_name: "State Farm",
  job_title: "Data Analyst",
  classification_status: "classified",
  ...overrides,
});

let mockSupabase: ReturnType<typeof createSupabaseMock>;

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => mockSupabase,
}));

describe("getInterviewRows", () => {
  beforeEach(() => {
    mockSupabase = createSupabaseMock([]);
  });

  it("applies the exact interview filter: category=interview_invite AND status != dead_letter", async () => {
    mockSupabase = createSupabaseMock([
      INTERVIEW_ROW({ id: "a", category: "interview_invite", classification_status: "classified" }),
      INTERVIEW_ROW({ id: "b", category: "interview_invite", classification_status: "dead_letter" }),
      INTERVIEW_ROW({ id: "c", category: "rejection", classification_status: "classified" }),
    ]);

    const { getInterviewRows } = await import("./operationsTable");
    const result = await getInterviewRows();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows.map((r) => r.id)).toEqual(["a"]);
    }
  });

  it("filters by search term across original_recipient, company_name, and job_title", async () => {
    mockSupabase = createSupabaseMock([
      INTERVIEW_ROW({ id: "a", company_name: "State Farm" }),
      INTERVIEW_ROW({ id: "b", company_name: "Accrete AI" }),
    ]);

    const { getInterviewRows } = await import("./operationsTable");
    const result = await getInterviewRows({ search: "state farm" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("filters by date range on received_at", async () => {
    mockSupabase = createSupabaseMock([
      INTERVIEW_ROW({ id: "a", received_at: "2026-06-01T00:00:00.000Z" }),
      INTERVIEW_ROW({ id: "b", received_at: "2026-07-05T00:00:00.000Z" }),
    ]);

    const { getInterviewRows } = await import("./operationsTable");
    const result = await getInterviewRows({ dateFrom: "2026-07-01", dateTo: "2026-07-31" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows.map((r) => r.id)).toEqual(["b"]);
  });

  it("paginates: returns correct page size, page slice, and total count", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => INTERVIEW_ROW({ id: `row-${i}` }));
    mockSupabase = createSupabaseMock(rows);

    const { getInterviewRows, INTERVIEWS_PAGE_SIZE } = await import("./operationsTable");
    const page1 = await getInterviewRows({ page: 1 });
    const page2 = await getInterviewRows({ page: 2 });
    const page3 = await getInterviewRows({ page: 3 });

    expect(page1.ok && page1.rows.length).toBe(INTERVIEWS_PAGE_SIZE);
    expect(page1.ok && page1.rows[0].id).toBe("row-0");
    expect(page2.ok && page2.rows[0].id).toBe(`row-${INTERVIEWS_PAGE_SIZE}`);
    expect(page3.ok && page3.rows.length).toBe(120 - INTERVIEWS_PAGE_SIZE * 2);
    expect(page1.ok && page1.totalCount).toBe(120);
  });

  it("passes through null company_name/job_title unchanged (UI decides the fallback text)", async () => {
    mockSupabase = createSupabaseMock([INTERVIEW_ROW({ id: "a", company_name: null, job_title: null })]);

    const { getInterviewRows } = await import("./operationsTable");
    const result = await getInterviewRows();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows[0].company_name).toBeNull();
      expect(result.rows[0].job_title).toBeNull();
    }
  });
});

describe("getInterviewById", () => {
  beforeEach(() => {
    mockSupabase = createSupabaseMock([]);
  });

  it("returns the row when it matches id and the interview filter", async () => {
    mockSupabase = createSupabaseMock([INTERVIEW_ROW({ id: "row-1" })]);

    const { getInterviewById } = await import("./operationsTable");
    const result = await getInterviewById("row-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.row.id).toBe("row-1");
  });

  it("returns not-ok when the id belongs to a different category (anti-tampering)", async () => {
    mockSupabase = createSupabaseMock([INTERVIEW_ROW({ id: "row-1", category: "rejection" })]);

    const { getInterviewById } = await import("./operationsTable");
    const result = await getInterviewById("row-1");

    expect(result.ok).toBe(false);
  });

  it("returns not-ok when the row is dead_letter (anti-tampering)", async () => {
    mockSupabase = createSupabaseMock([INTERVIEW_ROW({ id: "row-1", classification_status: "dead_letter" })]);

    const { getInterviewById } = await import("./operationsTable");
    const result = await getInterviewById("row-1");

    expect(result.ok).toBe(false);
  });

  it("returns not-ok when no row matches the id at all", async () => {
    mockSupabase = createSupabaseMock([]);

    const { getInterviewById } = await import("./operationsTable");
    const result = await getInterviewById("missing-id");

    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/zoho/operationsTable.test.ts`
Expected: FAIL with "Cannot find module './operationsTable'" (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/zoho/operationsTable.ts`:

```typescript
import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export const INTERVIEWS_PAGE_SIZE = 50;

const INTERVIEW_COLUMNS = [
  "id",
  "original_recipient",
  "received_at",
  "category",
  "confidence",
  "priority",
  "deadline",
  "action_required",
  "reason",
  "company_name",
  "job_title",
  "classification_status",
].join(",");

export interface InterviewRow {
  id: string;
  original_recipient: string | null;
  received_at: string | null;
  category: string | null;
  confidence: number | null;
  priority: string | null;
  deadline: string | null;
  action_required: string | null;
  reason: string | null;
  company_name: string | null;
  job_title: string | null;
  classification_status: string | null;
}

export interface InterviewFilters {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
}

export type GetInterviewRowsResult =
  | { ok: true; rows: InterviewRow[]; totalCount: number; page: number; pageSize: number }
  | { ok: false };

export async function getInterviewRows(filters: InterviewFilters = {}): Promise<GetInterviewRowsResult> {
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const from = (page - 1) * INTERVIEWS_PAGE_SIZE;
  const to = from + INTERVIEWS_PAGE_SIZE - 1;

  try {
    const supabase = createSupabaseServerClient();
    let query = supabase
      .from("zoho_email_metadata")
      .select(INTERVIEW_COLUMNS, { count: "exact" })
      .eq("category", "interview_invite")
      .neq("classification_status", "dead_letter");

    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.or(
        `original_recipient.ilike.${term},company_name.ilike.${term},job_title.ilike.${term}`,
      );
    }
    if (filters.dateFrom) query = query.gte("received_at", filters.dateFrom);
    if (filters.dateTo) query = query.lte("received_at", filters.dateTo);

    const { data, error, count } = await query.range(from, to);

    if (error) {
      console.error("[Operations Table] Interview rows query failed:", error.message);
      return { ok: false };
    }

    return {
      ok: true,
      rows: (data ?? []) as InterviewRow[],
      totalCount: count ?? 0,
      page,
      pageSize: INTERVIEWS_PAGE_SIZE,
    };
  } catch (error) {
    console.error(
      "[Operations Table] Interview rows query threw:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false };
  }
}

export type GetInterviewByIdResult = { ok: true; row: InterviewRow } | { ok: false };

export async function getInterviewById(id: string): Promise<GetInterviewByIdResult> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("zoho_email_metadata")
      .select(INTERVIEW_COLUMNS)
      .eq("id", id)
      .eq("category", "interview_invite")
      .neq("classification_status", "dead_letter")
      .maybeSingle();

    if (error) {
      console.error("[Operations Table] Interview row query failed:", error.message);
      return { ok: false };
    }
    if (!data) return { ok: false };

    return { ok: true, row: data as InterviewRow };
  } catch (error) {
    console.error(
      "[Operations Table] Interview row query threw:",
      error instanceof Error ? error.message : "unknown error",
    );
    return { ok: false };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/zoho/operationsTable.test.ts`
Expected: PASS — all tests pass, including pagination, filter-alignment, search, date range, null passthrough, and anti-tampering.

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/zoho/operationsTable.ts lib/zoho/operationsTable.test.ts
git commit -m "Add interview query helpers with pagination and anti-tampering"
```

---

### Task 4: Build the shared `FilteredEmailTable` component

**Files:**
- Create: `components/operations/FilteredEmailTable.tsx`

**Interfaces:**
- Consumes: `InterviewRow[]` shape from Task 3 (generalized as a prop type so later projects can pass their own row shape — see below).
- Produces: `<FilteredEmailTable>` used by Task 5's list page. No test file (per Global Constraints — `components/**` isn't unit-tested in this repo).

- [ ] **Step 1: Write the component**

Create `components/operations/FilteredEmailTable.tsx`:

```typescript
import Link from "next/link";

export interface FilteredEmailTableColumn<Row> {
  header: string;
  render: (row: Row) => React.ReactNode;
}

export interface FilteredEmailTableProps<Row extends { id: string }> {
  rows: Row[];
  columns: FilteredEmailTableColumn<Row>[];
  detailHrefBase: string;
  totalCount: number;
  page: number;
  pageSize: number;
  searchValue: string;
  dateFromValue: string;
  dateToValue: string;
  formAction: string;
  hiddenFields?: Record<string, string>;
}

export function FilteredEmailTable<Row extends { id: string }>({
  rows,
  columns,
  detailHrefBase,
  totalCount,
  page,
  pageSize,
  searchValue,
  dateFromValue,
  dateToValue,
  formAction,
  hiddenFields = {},
}: FilteredEmailTableProps<Row>) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const buildPageHref = (targetPage: number) => {
    const params = new URLSearchParams(hiddenFields);
    if (searchValue) params.set("search", searchValue);
    if (dateFromValue) params.set("from", dateFromValue);
    if (dateToValue) params.set("to", dateToValue);
    params.set("page", String(targetPage));
    return `${formAction}?${params.toString()}`;
  };

  return (
    <div className="coo-table-card">
      <form className="coo-date-form" action={formAction} method="get">
        {Object.entries(hiddenFields).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <label>
          <span>Search</span>
          <input type="text" name="search" defaultValue={searchValue} placeholder="Company, role, or client mailbox" />
        </label>
        <label>
          <span>From</span>
          <input type="date" name="from" defaultValue={dateFromValue} />
        </label>
        <label>
          <span>To</span>
          <input type="date" name="to" defaultValue={dateToValue} />
        </label>
        <button type="submit" className="coo-action-button">
          Apply
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="coo-empty">
          <strong>No results</strong>
          <p>
            {totalCount === 0 && !searchValue && !dateFromValue && !dateToValue
              ? "No interview records exist yet."
              : "No results match the current filters."}
          </p>
        </div>
      ) : (
        <>
          <table className="coo-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.header}>{col.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((col) => (
                    <td key={col.header}>{col.render(row)}</td>
                  ))}
                  <td>
                    <Link href={`${detailHrefBase}/${row.id}`}>View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="coo-pagination">
            <span>
              Page {page} of {totalPages} ({totalCount} total)
            </span>
            {page > 1 ? <Link href={buildPageHref(page - 1)}>Previous</Link> : null}
            {page < totalPages ? <Link href={buildPageHref(page + 1)}>Next</Link> : null}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check the new file**

Run: `npx tsc --noEmit`
Expected: no new errors attributable to `components/operations/FilteredEmailTable.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/operations/FilteredEmailTable.tsx
git commit -m "Add reusable FilteredEmailTable component"
```

---

### Task 5: Build `/operations/interviews` (list page)

**Files:**
- Create: `app/(operations)/interviews/page.tsx`

**Interfaces:**
- Consumes: `getInterviewRows` and `InterviewRow` from Task 3; `FilteredEmailTable` from Task 4.
- Produces: the URL `/operations/interviews`, linked from Task 7's dashboard card.

- [ ] **Step 1: Write the page**

Create `app/(operations)/interviews/page.tsx`:

```typescript
import { getInterviewRows } from "@/lib/zoho/operationsTable";
import { FilteredEmailTable } from "@/components/operations/FilteredEmailTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function valueFrom(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatDate(value: string | null): string {
  if (!value) return "Not available yet";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function InterviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const search = valueFrom(params.search);
  const from = valueFrom(params.from);
  const to = valueFrom(params.to);
  const page = Number(valueFrom(params.page)) || 1;

  const result = await getInterviewRows({
    search: search || undefined,
    dateFrom: from || undefined,
    dateTo: to || undefined,
    page,
  });

  if (!result.ok) {
    return (
      <main className="coo-page">
        <div className="coo-empty">
          <strong>Something went wrong loading this page.</strong>
        </div>
      </main>
    );
  }

  return (
    <main className="coo-page coo-interviews-page">
      <header className="coo-page__header">
        <div>
          <span className="coo-page__eyebrow">Operations</span>
          <h1 className="coo-page__title">Interviews</h1>
          <p className="coo-page__subtitle">{result.totalCount} interview-related emails found</p>
        </div>
      </header>

      <FilteredEmailTable
        rows={result.rows}
        totalCount={result.totalCount}
        page={result.page}
        pageSize={result.pageSize}
        searchValue={search}
        dateFromValue={from}
        dateToValue={to}
        formAction="/operations/interviews"
        detailHrefBase="/operations/interviews"
        columns={[
          { header: "Client Mailbox", render: (row) => row.original_recipient ?? "Not available yet" },
          { header: "Company", render: (row) => row.company_name ?? "Not available yet" },
          { header: "Role", render: (row) => row.job_title ?? "Not available yet" },
          { header: "Received", render: (row) => formatDate(row.received_at) },
          { header: "Priority", render: (row) => row.priority ?? "Not available yet" },
          { header: "Status", render: (row) => row.classification_status ?? "Not available yet" },
        ]}
      />
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors attributable to this file.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, then visit `http://localhost:3000/operations/interviews` in a browser (log in with the dashboard Basic Auth credentials).
Expected: page loads, shows a table of interview rows (or the "no interview records" empty state if none exist), search/date form is present, pagination links appear if `totalCount > 50`.

- [ ] **Step 4: Commit**

```bash
git add "app/(operations)/interviews/page.tsx"
git commit -m "Add /operations/interviews list page"
```

---

### Task 6: Build `/operations/interviews/[id]` (Email Metadata Details)

**Files:**
- Create: `app/(operations)/interviews/[id]/page.tsx`

**Interfaces:**
- Consumes: `getInterviewById` and `InterviewRow` from Task 3; Next.js's built-in `notFound()` from `next/navigation`.
- Produces: the URL `/operations/interviews/[id]`, linked from Task 5's table rows.

- [ ] **Step 1: Write the page**

Create `app/(operations)/interviews/[id]/page.tsx`:

```typescript
import { notFound } from "next/navigation";

import { getInterviewById } from "@/lib/zoho/operationsTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(value: string | null): string {
  if (!value) return "Not available yet";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function InterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getInterviewById(id);

  if (!result.ok) {
    notFound();
  }

  const row = result.row;

  return (
    <main className="coo-page coo-interview-detail-page">
      <header className="coo-page__header">
        <div>
          <span className="coo-page__eyebrow">Email Metadata Details</span>
          <h1 className="coo-page__title">{row.company_name ?? "Not available yet"}</h1>
          <p className="coo-page__subtitle">{row.job_title ?? "Not available yet"}</p>
        </div>
      </header>

      <dl className="coo-detail-list">
        <dt>Client mailbox</dt>
        <dd>{row.original_recipient ?? "Not available yet"}</dd>

        <dt>Company</dt>
        <dd>{row.company_name ?? "Not available yet"}</dd>

        <dt>Role</dt>
        <dd>{row.job_title ?? "Not available yet"}</dd>

        <dt>Received</dt>
        <dd>{formatDate(row.received_at)}</dd>

        <dt>Category</dt>
        <dd>{row.category ?? "Not available yet"}</dd>

        <dt>Confidence</dt>
        <dd>{row.confidence !== null ? `${Math.round(row.confidence * 100)}%` : "Not available yet"}</dd>

        <dt>Priority</dt>
        <dd>{row.priority ?? "Not available yet"}</dd>

        <dt>Deadline</dt>
        <dd>{row.deadline ?? "Not available yet"}</dd>

        <dt>Action required</dt>
        <dd>{row.action_required ?? "Not available yet"}</dd>

        <dt>Reason</dt>
        <dd>{row.reason ?? "Not available yet"}</dd>

        <dt>Status</dt>
        <dd>{row.classification_status ?? "Not available yet"}</dd>
      </dl>
    </main>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors attributable to this file.

- [ ] **Step 3: Manual verification**

With `npm run dev` running, click a row from `/operations/interviews`.
Expected: detail page renders the fields above. Manually edit the URL to an id belonging to a different category (e.g. a `rejection` row's id, found via the Supabase dashboard) — expected: Next.js's default not-found page, not the other category's data.

- [ ] **Step 4: Commit**

```bash
git add "app/(operations)/interviews/[id]/page.tsx"
git commit -m "Add /operations/interviews/[id] Email Metadata Details page"
```

---

### Task 7: Make the dashboard's "Interviews" card clickable

**Files:**
- Modify: `components/coo.tsx:17-40` (`MetricCard`)
- Modify: `app/(operations)/overview/page.tsx:203` (the "Interviews" `MetricCard` usage)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MetricCard` gains an optional `href` prop, backward-compatible with every other existing usage (all other cards omit it and render exactly as before).

- [ ] **Step 1: Add an optional `href` prop to `MetricCard`**

In `components/coo.tsx`, replace the `MetricCard` function:

```typescript
import Link from "next/link";

export function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
  href,
}: {
  label: string;
  value: number | string;
  hint: string;
  tone?: Tone;
  icon?: ReactNode;
  href?: string;
}) {
  const content = (
    <>
      <div className="coo-metric__head">
        <span className="coo-metric__label">{label}</span>
        {icon ? <span className="coo-metric__icon">{icon}</span> : null}
      </div>
      <strong className="coo-metric__value">{value}</strong>
      <p className="coo-metric__hint">{hint}</p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`coo-metric coo-metric--${tone} coo-metric--clickable`}>
        {content}
      </Link>
    );
  }

  return <article className={`coo-metric coo-metric--${tone}`}>{content}</article>;
}
```

(Add `import Link from "next/link";` to the top of `components/coo.tsx` alongside the existing `import type { ReactNode } from "react";`.)

- [ ] **Step 2: Wire the Interviews card to link to `/operations/interviews`, carrying over the dashboard's date filter**

The existing `buildUrl` helper in this file (line 30-44) is hardcoded to return a `/overview?...` URL — it always prefixes with `/overview` internally, so it cannot be reused as-is for a different path. Do not call it or string-replace its output. Instead, build the interviews link directly, right above the `return (` statement (after the existing `hasActivity` line):

```typescript
  const interviewsParams = new URLSearchParams();
  if (from) interviewsParams.set("from", from);
  if (to) interviewsParams.set("to", to);
  const interviewsHref = interviewsParams.toString()
    ? `/operations/interviews?${interviewsParams.toString()}`
    : "/operations/interviews";
```

Then replace the "Interviews" `MetricCard` line (currently line 203) with exactly this — one `href` prop, nothing else:

```typescript
          <MetricCard
            label="Interviews"
            value={data.metrics.interviews}
            hint="Highest-signal follow up"
            tone="interview"
            href={interviewsHref}
          />
```

**This `MetricCard` must have exactly one `href` prop: `href={interviewsHref}`.** Do not also keep or add `href={buildUrl(new URLSearchParams(), { from, to }).replace("/overview", "/operations/interviews")}` — that line must not appear anywhere in the final code. Two `href` attributes on the same JSX element is invalid anyway (the second would silently win); there is exactly one correct line, shown above.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

With `npm run dev` running, visit `/overview`, apply a date range via the existing "From"/"To" form, then click the "Interviews" card.
Expected: navigates to `/operations/interviews?from=...&to=...` with the same date range carried over, and the total shown matches the dashboard's "Interviews" count for that same range. Also verify every other `MetricCard` on the page (Applications, Offers, Rejections, etc.) still renders as a plain non-clickable card, unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/coo.tsx "app/(operations)/overview/page.tsx"
git commit -m "Make the Interviews dashboard card clickable"
```

---

### Task 8: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, zero failures, across every existing suite plus the two new ones from Tasks 2 and 3.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: zero errors (warnings acceptable only if they already exist elsewhere in the codebase; do not introduce new ones).

- [ ] **Step 4: Confirm no forbidden scope was touched**

Run: `git diff --stat 155785b..HEAD -- worker/ lib/zoho/syncEmails.ts lib/worker-core/ middleware.ts`
Expected: empty output — none of these paths appear in the diff for this plan's commits.

- [ ] **Step 5: Confirm every new/modified Supabase query uses an explicit column list**

Run: `grep -rn 'select("\*")' lib/zoho/operationsTable.ts app/`
Expected: no matches.

- [ ] **Step 6: Report status — do not push, do not deploy**

Summarize: all commits are local only, migration from Task 1 has not been applied to the production Supabase project (that's a separate explicit step), nothing has been pushed to any remote, nothing deployed.
