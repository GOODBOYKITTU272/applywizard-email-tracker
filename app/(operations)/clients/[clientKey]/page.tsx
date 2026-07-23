import Link from "next/link";

import { CooBadge, EmptyState, MetricCard, SectionBlock } from "@/components/coo";
import { requireOperationsAccess } from "@/lib/dashboardAuth/requireOperationsAccess";
import { getClientDetailWorkspaceData } from "@/lib/zoho/cooWorkspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = Promise<{ clientKey: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DATE_PRESETS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 7 Days", value: "last_7_days" },
  { label: "Last 30 Days", value: "last_30_days" },
  { label: "Custom Range", value: "custom" },
] as const;

function valueFrom(param: string | string[] | undefined): string | null {
  if (Array.isArray(param)) return param[0] ?? null;
  return param ?? null;
}

function buildUrl(
  clientKey: string,
  current: URLSearchParams,
  updates: Record<string, string | null | undefined>,
): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === "") next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `/clients/${clientKey}?${query}` : `/clients/${clientKey}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function formatDateOnly(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(parsed);
}

function toneForCategory(value: string | null): "offer" | "interview" | "assessment" | "review" | "neutral" {
  if (value === "job_offer") return "offer";
  if (value === "interview_invite") return "interview";
  if (value === "assessment") return "assessment";
  if (value === "review" || value === "unknown") return "review";
  return "neutral";
}

function toneForSummaryLabel(label: string): "offer" | "interview" | "assessment" | "review" | "neutral" {
  if (label === "Offers") return "offer";
  if (label === "Interviews") return "interview";
  if (label === "Assessments") return "assessment";
  if (label === "Follow-up Needed" || label === "Review Needed") return "review";
  return "neutral";
}

function toneForQueue(value: string | null): "success" | "warning" | "critical" | "neutral" | "review" {
  if (value === "dead_letter") return "critical";
  if (value === "review") return "review";
  if (value === "retry_scheduled" || value === "pending") return "warning";
  if (value === "processing") return "neutral";
  return "success";
}

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireOperationsAccess();

  const [{ clientKey }, resolvedParams] = await Promise.all([params, searchParams]);
  const current = new URLSearchParams();
  const range = valueFrom(resolvedParams.range) ?? "today";
  const from = valueFrom(resolvedParams.from);
  const to = valueFrom(resolvedParams.to);

  for (const [key, value] of Object.entries({ range, from, to })) {
    if (value) current.set(key, value);
  }

  const data = await getClientDetailWorkspaceData({
    clientKey,
    range,
    from,
    to,
  });

  if (!data) {
    return (
      <main className="coo-page">
        <SectionBlock title="Invalid client link" subtitle="This client link could not be resolved.">
          <EmptyState
            title="Invalid client link"
            description="Return to the Clients page and open a row from the live list."
            action={<Link href="/clients" className="coo-inline-link">Back to Clients</Link>}
          />
        </SectionBlock>
      </main>
    );
  }

  const summary = data.summary;

  return (
    <main className="coo-page coo-client-detail-page">
      <header className="coo-page__header">
        <div>
          <span className="coo-page__eyebrow">Client Detail</span>
          <h1 className="coo-page__title">{data.originalRecipient}</h1>
          <p className="coo-page__subtitle">
            Temporary identity until Leads API mapping exists. Client name placeholder intentionally left empty.
          </p>
        </div>
        <div className="coo-page__meta">
          <CooBadge label={data.dateRange.label} tone="neutral" />
          <CooBadge label={summary.queueState} tone={toneForQueue(summary.queueState)} />
          <CooBadge label={`Urgency: ${summary.urgency}`} tone={toneForCategory(summary.urgency === "offer" ? "job_offer" : summary.urgency === "interview" ? "interview_invite" : summary.urgency === "assessment" ? "assessment" : summary.urgency === "review required" ? "review" : null)} />
        </div>
      </header>

      <section className="coo-toolbar" aria-label="Client date filters">
        <div className="coo-toolbar__group">
          {DATE_PRESETS.map((preset) => (
            <Link key={preset.value} href={buildUrl(clientKey, current, { range: preset.value })} className={`coo-filter-link ${range === preset.value ? "active" : ""}`}>
              {preset.label}
            </Link>
          ))}
        </div>
        <form className="coo-date-form" action={`/clients/${clientKey}`} method="get">
          <input type="hidden" name="range" value={range} />
          <label>
            <span>From</span>
            <input type="date" name="from" defaultValue={from ?? ""} />
          </label>
          <label>
            <span>To</span>
            <input type="date" name="to" defaultValue={to ?? ""} />
          </label>
          <button type="submit" className="coo-action-button">
            Apply
          </button>
        </form>
      </section>

      <SectionBlock title="Quick State Summary" subtitle="Current queue state, urgency, and email volume for this client.">
        <div className="coo-metric-grid coo-metric-grid--client-detail">
          <MetricCard label="Total Emails" value={summary.totalEmails} hint="Selected range" tone="neutral" />
          <MetricCard label="New Emails" value={summary.newEmails} hint="Based on when the email entered the system" tone="neutral" />
          <MetricCard label="Queue State" value={summary.queueState} hint="Current operational state" tone="review" />
          <MetricCard label="Urgency" value={summary.urgency} hint="Highest signal present" tone={summary.urgency === "offer" ? "offer" : summary.urgency === "interview" ? "interview" : summary.urgency === "assessment" ? "assessment" : "review"} />
        </div>
      </SectionBlock>

      <SectionBlock title="Category Summary" subtitle="Business categories only. Queue state stays separate.">
        <div className="coo-chip-grid">
          {[
            ["Applications", summary.applications],
            ["Interviews", summary.interviews],
            ["Assessments", summary.assessments],
            ["Offers", summary.offers],
            ["Rejections", summary.rejections],
            ["Recruiter Replies", summary.recruiterReplies],
            ["Follow-up Needed", summary.followUpNeeded],
            ["Review Needed", summary.reviewCount],
          ].map(([label, value]) => (
            <article key={String(label)} className="coo-mini-card">
              <span className="coo-mini-card__label">{label}</span>
              <strong className="coo-mini-card__value">{String(value)}</strong>
              <span className="coo-mini-card__tone">
                <CooBadge label={String(label)} tone={toneForSummaryLabel(String(label))} />
              </span>
            </article>
          ))}
        </div>
      </SectionBlock>

      <SectionBlock
        title="Activity Timeline"
        subtitle="Newest first. Category badge and queue-status badge remain separate."
      >
        {!data.timeline.length ? (
          <EmptyState
            title={data.hasRows ? "No timeline events in the selected range." : "No activity in this date range."}
            description={data.hasRows ? "Try a wider date range to see client activity." : "Try a wider range."}
          />
        ) : (
          <div className="coo-timeline">
            {data.timeline.map((event) => (
              <article key={event.id} className="coo-timeline-card">
                <div className="coo-timeline-card__top">
                  <div className="coo-chip-row">
                    <CooBadge label={event.category ?? "unknown"} tone={toneForCategory(event.category)} />
                    <CooBadge label={event.classificationStatus ?? "unknown"} tone={toneForQueue(event.classificationStatus)} />
                    {event.isPending ? <CooBadge label="Awaiting classification" tone="warning" /> : null}
                  </div>
                  <time className="coo-activity-time" dateTime={event.receivedAt}>
                    {formatDateTime(event.receivedAt)}
                  </time>
                </div>

                <div className="coo-timeline-card__meta">
                  <span>Queue age: {event.queueAgeMinutes === null ? "—" : `${event.queueAgeMinutes}m`}</span>
                  {event.deadline ? <span>Deadline: {formatDateOnly(event.deadline) ?? event.deadline}</span> : null}
                  {event.actionRequired ? <span>Action: {event.actionRequired}</span> : null}
                  {typeof event.confidence === "number" ? <span>Confidence: {(event.confidence * 100).toFixed(0)}%</span> : null}
                </div>

                {event.isReview ? (
                  <div className="coo-review-note">
                    <CooBadge label="Review" tone="review" />
                    <p>{event.safeReason ?? "Classification reason redacted for safety."}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </SectionBlock>

    </main>
  );
}
