import { FilteredEmailTable } from "@/components/operations/FilteredEmailTable";
import { requireOperationsAccess } from "@/lib/dashboardAuth/requireOperationsAccess";
import { getInterviewRows } from "@/lib/zoho/operationsTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function valueFrom(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function formatDate(value: string | null): string {
  if (!value) return "Not available yet";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function InterviewsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOperationsAccess();

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
