import Link from "next/link";

import { CooBadge, EmptyState, MetricCard, SectionBlock } from "@/components/coo";
import { requireOperationsAccess } from "@/lib/dashboardAuth/requireOperationsAccess";
import { getClientsWorkspaceData } from "@/lib/zoho/cooWorkspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DATE_PRESETS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 Days", value: "last_7_days" },
  { label: "Last 30 Days", value: "last_30_days" },
  { label: "Custom Range", value: "custom" },
] as const;

const STAGE_PRESETS = [
  { label: "All", value: "all" },
  { label: "Awaiting Classification", value: "awaiting_classification" },
  { label: "Classified Activity", value: "classified_activity" },
] as const;

const URGENCY_PRESETS = [
  { label: "All", value: "all" },
  { label: "Offers", value: "offers" },
  { label: "Interviews", value: "interviews" },
  { label: "Assessments", value: "assessments" },
  { label: "Review Needed", value: "review_needed" },
] as const;

const QUEUE_PRESETS = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Processing", value: "processing" },
  { label: "Retry Scheduled", value: "retry_scheduled" },
  { label: "Review", value: "review" },
  { label: "Dead Letter", value: "dead_letter" },
] as const;

function valueFrom(param: string | string[] | undefined): string | null {
  if (Array.isArray(param)) return param[0] ?? null;
  return param ?? null;
}

function buildUrl(
  current: URLSearchParams,
  updates: Record<string, string | null | undefined>,
): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `/clients?${query}` : "/clients";
}

function formatDeadline(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(parsed);
}

function toneForUrgency(value: string): "offer" | "interview" | "assessment" | "review" | "neutral" {
  if (value === "offer") return "offer";
  if (value === "interview") return "interview";
  if (value === "assessment") return "assessment";
  if (value === "review required") return "review";
  return "neutral";
}

function toneForQueue(value: string): "success" | "warning" | "critical" | "neutral" | "review" {
  if (value === "Dead Letter") return "critical";
  if (value === "Review Queue") return "review";
  if (value === "Retrying" || value === "Pending") return "warning";
  if (value === "Processing") return "neutral";
  return "success";
}

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireOperationsAccess();

  const params = await searchParams;
  const current = new URLSearchParams();
  const range = valueFrom(params.range) ?? "today";
  const stage = valueFrom(params.stage) ?? "all";
  const urgency = valueFrom(params.urgency) ?? "all";
  const queue = valueFrom(params.queue) ?? "all";
  const q = valueFrom(params.q) ?? "";
  const from = valueFrom(params.from);
  const to = valueFrom(params.to);

  for (const [key, value] of Object.entries({ range, stage, urgency, queue, q, from, to })) {
    if (value) current.set(key, value);
  }

  const data = await getClientsWorkspaceData({
    range,
    stage,
    urgency,
    queue,
    q,
    from,
    to,
  });

  const totalClients = data.rows.length;
  const urgentClients = data.rows.filter((row) => row.urgency !== "other").length;
  const reviewClients = data.rows.filter((row) => row.reviewCount > 0).length;
  const deadLetterClients = data.rows.filter((row) => row.deadLetterCount > 0).length;

  return (
    <main className="coo-page coo-clients-page">
      <header className="coo-page__header">
        <div>
          <span className="coo-page__eyebrow">Clients</span>
          <h1 className="coo-page__title">Client-Centric Operations List</h1>
          <p className="coo-page__subtitle">
            Temporary identity uses the client mailbox until Leads API mapping exists.
          </p>
        </div>
        <div className="coo-page__meta">
          <CooBadge label={data.dateRange.label} tone="neutral" />
          <CooBadge label={data.rows.length ? `${data.rows.length} clients` : "No clients"} tone={data.rows.length ? "success" : "neutral"} />
        </div>
      </header>

      <section className="coo-toolbar" aria-label="Client filters">
        <div className="coo-toolbar__group" role="tablist" aria-label="Date ranges">
          {DATE_PRESETS.map((preset) => (
            <Link key={preset.value} href={buildUrl(current, { range: preset.value })} className={`coo-filter-link ${range === preset.value ? "active" : ""}`}>
              {preset.label}
            </Link>
          ))}
        </div>
        <div className="coo-toolbar__group" role="tablist" aria-label="Stage filters">
          {STAGE_PRESETS.map((preset) => (
            <Link key={preset.value} href={buildUrl(current, { stage: preset.value })} className={`coo-filter-link ${stage === preset.value ? "active" : ""}`}>
              {preset.label}
            </Link>
          ))}
        </div>
        <div className="coo-toolbar__group" role="tablist" aria-label="Urgency filters">
          {URGENCY_PRESETS.map((preset) => (
            <Link key={preset.value} href={buildUrl(current, { urgency: preset.value })} className={`coo-filter-link ${urgency === preset.value ? "active" : ""}`}>
              {preset.label}
            </Link>
          ))}
        </div>
        <div className="coo-toolbar__group" role="tablist" aria-label="Queue filters">
          {QUEUE_PRESETS.map((preset) => (
            <Link key={preset.value} href={buildUrl(current, { queue: preset.value })} className={`coo-filter-link ${queue === preset.value ? "active" : ""}`}>
              {preset.label}
            </Link>
          ))}
        </div>

        <form className="coo-search-form" action="/clients" method="get">
          <input type="hidden" name="range" value={range} />
          <input type="hidden" name="stage" value={stage} />
          <input type="hidden" name="urgency" value={urgency} />
          <input type="hidden" name="queue" value={queue} />
          <input type="hidden" name="from" value={from ?? ""} />
          <input type="hidden" name="to" value={to ?? ""} />
          <label>
            <span>Search client identity</span>
            <input type="search" name="q" defaultValue={q} placeholder="Search client mailbox..." />
          </label>
          <button type="submit" className="coo-action-button">Search</button>
        </form>
      </section>

      <SectionBlock title="Client Summary" subtitle="Overview of the selected client window.">
        <div className="coo-metric-grid coo-metric-grid--clients">
          <MetricCard label="Clients" value={totalClients} hint="Grouped by client mailbox" tone="neutral" />
          <MetricCard label="Urgent Clients" value={urgentClients} hint="Offers, interviews, assessments, review" tone="offer" />
          <MetricCard label="Review Needed" value={reviewClients} hint="Emails needing human review" tone="review" />
          <MetricCard label="Dead Letter Clients" value={deadLetterClients} hint="Visible in queue filters" tone="critical" />
        </div>
      </SectionBlock>

      <SectionBlock
        title="Clients & Mailboxes"
        subtitle="Client identity, live activity, and queue status without exposing tracker@applywizard.ai."
      >
        {!data.rows.length ? (
          <EmptyState title="No clients found." description="Try widening the date range or clearing filters." />
        ) : (
          <>
            <div className="coo-table-card">
              <table className="coo-table coo-table--clients">
                <thead>
                  <tr>
                    <th>Client Identity</th>
                    <th>Total Emails</th>
                    <th>New Emails</th>
                    <th>Latest Meaningful Update</th>
                    <th>Interviews</th>
                    <th>Assessments</th>
                    <th>Offers</th>
                    <th>Rejections</th>
                    <th>Review Count</th>
                    <th>Queue State</th>
                    <th>Urgency</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.clientKey}>
                      <td className="coo-client-cell">
                        <Link href={`/clients/${row.clientKey}`} className="coo-client-link">{row.originalRecipient}</Link>
                        <span className="coo-client-note">Client name available after Leads mapping</span>
                      </td>
                      <td>{row.totalEmails}</td>
                      <td>{row.newEmails}</td>
                      <td className="coo-update-cell">
                        <span>{row.latestUpdateLabel}</span>
                        {row.latestMeaningfulDeadline ? <span className="coo-update-note">Deadline: {formatDeadline(row.latestMeaningfulDeadline)}</span> : null}
                      </td>
                      <td>{row.interviews}</td>
                      <td>{row.assessments}</td>
                      <td className="coo-highlight">{row.offers}</td>
                      <td>{row.rejections}</td>
                      <td>{row.reviewCount}</td>
                      <td><CooBadge label={row.queueState} tone={toneForQueue(row.queueState)} /></td>
                      <td><CooBadge label={row.urgency} tone={toneForUrgency(row.urgency)} /></td>
                      <td><Link href={`/clients/${row.clientKey}`} className="coo-inline-link">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="coo-mobile-grid">
              {data.rows.map((row) => (
                <Link key={row.clientKey} href={`/clients/${row.clientKey}`} className="coo-mobile-card">
                  <div className="coo-mobile-card__top">
                    <div>
                      <div className="coo-mobile-card__title">{row.originalRecipient}</div>
                      <div className="coo-mobile-card__subtitle">{row.latestUpdateLabel}</div>
                    </div>
                    <div className="coo-chip-stack">
                      <CooBadge label={row.queueState} tone={toneForQueue(row.queueState)} />
                      <CooBadge label={row.urgency} tone={toneForUrgency(row.urgency)} />
                    </div>
                  </div>
                  <div className="coo-mobile-card__stats">
                    <span>Total {row.totalEmails}</span>
                    <span>New {row.newEmails}</span>
                    <span>Interviews {row.interviews}</span>
                    <span>Offers {row.offers}</span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </SectionBlock>

    </main>
  );
}
