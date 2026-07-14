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
  const makeQuery = (columns?: string) => {
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
        const selectedColumns = columns
          ?.split(",")
          .map((column) => column.trim())
          .filter(Boolean);
        const project = (row: MockRow) =>
          selectedColumns
            ? Object.fromEntries(selectedColumns.map((column) => [column, row[column]]))
            : row;
        if (state.single) {
          resolve({ data: filtered[0] ? project(filtered[0]) : null, error: null });
          return;
        }
        const ranged = state.range ? filtered.slice(state.range.start, state.range.end + 1) : filtered;
        resolve({ data: ranged.map(project), error: null, count: filtered.length });
      },
    };

    return query;
  };

  return {
    from: () => ({
      select: (columns?: string) => makeQuery(columns),
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

  it("selects human review fields alongside the existing metadata fields", async () => {
    mockSupabase = createSupabaseMock([
      INTERVIEW_ROW({ id: "row-1", human_category: "recruiter_reply", reviewed_by: "admin", reviewed_at: "2026-07-08T00:00:00.000Z" }),
    ]);

    const { getInterviewById } = await import("./operationsTable");
    const result = await getInterviewById("row-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.human_category).toBe("recruiter_reply");
      expect(result.row.reviewed_by).toBe("admin");
    }
  });
});
