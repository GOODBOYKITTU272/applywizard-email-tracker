import Link from "next/link";
import type { ReactNode } from "react";

export interface FilteredEmailTableColumn<Row> {
  header: string;
  render: (row: Row) => ReactNode;
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
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((col) => (
                    <td key={col.header}>{col.render(row)}</td>
                  ))}
                  <td>
                    <Link href={`${detailHrefBase}/${row.id}`} className="coo-inline-link">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="coo-pagination">
            <span>
              Page {page} of {totalPages} ({totalCount} total)
            </span>
            {page > 1 ? <Link href={buildPageHref(page - 1)} className="coo-inline-link">Previous</Link> : null}
            {page < totalPages ? <Link href={buildPageHref(page + 1)} className="coo-inline-link">Next</Link> : null}
          </div>
        </>
      )}
    </div>
  );
}
