import Link from "next/link";

import { CooBadge, EmptyState, MetricCard, SectionBlock } from "@/components/coo";
import { getOverviewWorkspaceData } from "@/lib/zoho/cooWorkspace";

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
    if (value === null || value === undefined || value === "") {
      next.delete(key);
      continue;
    }
    next.set(key, value);
  }
  const query = next.toString();
  return query ? `/overview?${query}` : "/overview";
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not available yet";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
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

function toneForCategory(category: string | null): "offer" | "interview" | "assessment" | "review" | "neutral" {
  if (category === "job_offer") return "offer";
  if (category === "interview_invite") return "interview";
  if (category === "assessment") return "assessment";
  if (category === "review" || category === "unknown") return "review";
  return "neutral";
}

function toneForQueue(queueStatus: string | null): "success" | "warning" | "critical" | "neutral" | "review" {
  if (queueStatus === "review") return "review";
  if (queueStatus === "dead_letter") return "critical";
  if (queueStatus === "retry_scheduled") return "warning";
  if (queueStatus === "pending") return "warning";
  if (queueStatus === "processing") return "neutral";
  return "success";
}

function toneForQueueState(value: string): "success" | "warning" | "critical" | "neutral" | "review" {
  if (value === "Dead Letter") return "critical";
  if (value === "Review Queue") return "review";
  if (value === "Retrying" || value === "Pending") return "warning";
  if (value === "Processing") return "neutral";
  return "success";
}

export default async function OverviewPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const current = new URLSearchParams();
  const range = valueFrom(params.range) ?? "today";
  const stage = valueFrom(params.stage) ?? "all";
  const deadline = valueFrom(params.deadline) ?? null;
  const from = valueFrom(params.from);
  const to = valueFrom(params.to);

  for (const [key, value] of Object.entries({
    range,
    stage,
    deadline,
    from,
    to,
  })) {
    if (value) current.set(key, value);
  }

  const data = await getOverviewWorkspaceData({
    range,
    stage,
    deadlineTomorrowOnly: deadline === "tomorrow",
    from,
    to,
  });

  const latestIngest = formatDateTime(data.metrics.latestSuccessfulIngestAt);
  const hasRows = data.clientRows.length > 0;
  const hasActivity = data.activityRows.length > 0;

  return (
    <main className="coo-page coo-overview-page">
      <header className="coo-page__header">
        <div>
          <span className="coo-page__eyebrow">Operations Overview</span>
          <h1 className="coo-page__title">Master COO Email Tracking</h1>
          <p className="coo-page__subtitle">
            Client-first live tracking before and after classification.
          </p>
        </div>
        <div className="coo-page__meta">
          <CooBadge label={`Latest ingest: ${latestIngest}`} tone={data.metrics.latestSuccessfulIngestAt ? "success" : "neutral"} />
          <CooBadge label={data.dateRange.label} tone="neutral" />
          <CooBadge label={data.stageFilter === "all" ? "All stages" : data.stageFilter.replace("_", " ")} tone="neutral" />
          {data.deadlineTomorrowOnly ? <CooBadge label="Deadline tomorrow" tone="warning" /> : null}
        </div>
      </header>

      <section className="coo-toolbar" aria-label="Overview filters">
        <div className="coo-toolbar__group" role="tablist" aria-label="Date ranges">
          {DATE_PRESETS.map((preset) => (
            <Link
              key={preset.value}
              href={buildUrl(current, { range: preset.value })}
              className={`coo-filter-link ${range === preset.value ? "active" : ""}`}
            >
              {preset.label}
            </Link>
          ))}
        </div>

        <div className="coo-toolbar__group" role="tablist" aria-label="Stage filters">
          {STAGE_PRESETS.map((preset) => (
            <Link
              key={preset.value}
              href={buildUrl(current, { stage: preset.value })}
              className={`coo-filter-link ${stage === preset.value ? "active" : ""}`}
            >
              {preset.label}
            </Link>
          ))}
        </div>

        <div className="coo-toolbar__group">
          <Link
            href={buildUrl(current, {
              deadline: deadline === "tomorrow" ? null : "tomorrow",
            })}
            className={`coo-filter-link ${deadline === "tomorrow" ? "active" : ""}`}
          >
            Deadline Tomorrow
          </Link>
        </div>

        <form className="coo-date-form" action="/overview" method="get">
          <input type="hidden" name="stage" value={stage} />
          <input type="hidden" name="deadline" value={deadline ?? ""} />
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

      <SectionBlock
        title="Today"
        subtitle="Counts are based on received_at, with classified throughput shown separately."
      >
        <div className="coo-metric-grid">
          <MetricCard label="Total Emails" value={data.metrics.totalEmails} hint="Selected business window" tone="neutral" />
          <MetricCard label="New Emails" value={data.metrics.newEmails} hint="Based on first_seen_at" tone="neutral" />
          <MetricCard label="Pending Classification" value={data.metrics.pendingClassification} hint="Awaiting work" tone="warning" />
          <MetricCard label="Classified" value={data.metrics.classifiedToday} hint="Based on classified_at" tone="success" />
          <MetricCard label="Review Queue" value={data.metrics.review} hint="Needs human review" tone="review" />
          <MetricCard label="Applications" value={data.metrics.applications} hint="application_received" tone="neutral" />
          <MetricCard label="Interviews" value={data.metrics.interviews} hint="Highest-signal follow up" tone="interview" />
          <MetricCard label="Assessments" value={data.metrics.assessments} hint="Timed evaluation requests" tone="assessment" />
          <MetricCard label="Offers" value={data.metrics.offers} hint="Highest-priority activity" tone="offer" />
          <MetricCard label="Rejections" value={data.metrics.rejections} hint="Closed opportunities" tone="neutral" />
          <MetricCard label="Recruiter Replies" value={data.metrics.recruiterReplies} hint="Response handling" tone="neutral" />
          <MetricCard label="Follow-up Needed" value={data.metrics.followUpNeeded} hint="Needs action" tone="review" />
        </div>
      </SectionBlock>

      <SectionBlock
        title="Master Client Tracking"
        subtitle="One row per original_recipient. Tracker mailbox is hidden from the client identity surface."
      >
        {!hasRows ? (
          <EmptyState
            title="No client rows for the selected filters."
            description="Try a wider date range or switch the stage filter to All."
          />
        ) : (
          <>
            <div className="coo-table-card">
              <table className="coo-table coo-table--overview">
                <thead>
                  <tr>
                    <th>Client Identity</th>
                    <th>Total Emails</th>
                    <th>New Emails</th>
                    <th>Applications</th>
                    <th>Interviews</th>
                    <th>Assessments</th>
                    <th>Offers</th>
                    <th>Rejections</th>
                    <th>Recruiter Replies</th>
                    <th>Follow-up Needed</th>
                    <th>Last Meaningful Update</th>
                    <th>Queue Status</th>
                    <th>Urgency</th>
                  </tr>
                </thead>
                <tbody>
                  {data.clientRows.map((row) => (
                    <tr key={row.clientKey}>
                      <td className="coo-client-cell">
                        <Link href={`/clients/${row.clientKey}`} className="coo-client-link">
                          {row.originalRecipient}
                        </Link>
                        <span className="coo-client-note">Client name available after Leads mapping</span>
                      </td>
                      <td>{row.totalEmails}</td>
                      <td>{row.newEmails}</td>
                      <td>{row.applications}</td>
                      <td>{row.interviews}</td>
                      <td>{row.assessments}</td>
                      <td className="coo-highlight">{row.offers}</td>
                      <td>{row.rejections}</td>
                      <td>{row.recruiterReplies}</td>
                      <td>{row.followUpNeeded}</td>
                      <td className="coo-update-cell">
                        <span>{row.latestUpdateLabel}</span>
                        {row.latestMeaningfulDeadline ? (
                          <span className="coo-update-note">Deadline: {formatDeadline(row.latestMeaningfulDeadline)}</span>
                        ) : null}
                      </td>
                      <td>
                        <CooBadge label={row.queueState} tone={toneForQueueState(row.queueState)} />
                      </td>
                      <td>
                        <CooBadge label={row.urgency} tone={row.urgency === "offer" ? "offer" : row.urgency === "interview" ? "interview" : row.urgency === "assessment" ? "assessment" : row.urgency === "review required" ? "review" : "neutral"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="coo-mobile-grid">
              {data.clientRows.map((row) => (
                <Link key={row.clientKey} href={`/clients/${row.clientKey}`} className="coo-mobile-card">
                  <div className="coo-mobile-card__top">
                    <div>
                      <div className="coo-mobile-card__title">{row.originalRecipient}</div>
                      <div className="coo-mobile-card__subtitle">{row.latestUpdateLabel}</div>
                    </div>
                    <div className="coo-chip-stack">
                      <CooBadge label={row.queueState} tone={row.queueState === "Dead Letter" ? "critical" : row.queueState === "Review Queue" ? "review" : "neutral"} />
                      <CooBadge label={row.urgency} tone={row.urgency === "offer" ? "offer" : row.urgency === "interview" ? "interview" : row.urgency === "assessment" ? "assessment" : row.urgency === "review required" ? "review" : "neutral"} />
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

      <div className="coo-dual-grid">
        <SectionBlock
          title="System Health"
          subtitle="Queue state and ingestion freshness for the tracker pipeline."
          action={<Link href="/dashboard" className="coo-inline-link">Open technical dashboard</Link>}
        >
          <div className="coo-system-grid">
            <MetricCard label="Pending" value={data.metrics.pending} hint="Awaiting classification" tone="warning" />
            <MetricCard label="Processing" value={data.metrics.processing} hint="Claims in flight" tone="neutral" />
            <MetricCard label="Retry Scheduled" value={data.metrics.retryScheduled} hint="Waiting for next attempt" tone="warning" />
            <MetricCard label="Review" value={data.metrics.review} hint="Human review required" tone="review" />
            <MetricCard label="Dead Letter" value={data.metrics.deadLetter} hint="Failed safely" tone="critical" />
            <MetricCard label="Oldest Backlog Age" value={data.metrics.oldestBacklogAgeMinutes === null ? "—" : `${data.metrics.oldestBacklogAgeMinutes}m`} hint="first_seen_at or created_at" tone="warning" />
            <MetricCard label="Latest Successful Ingest" value={latestIngest} hint="zoho_sync_checkpoints" tone={data.metrics.latestSuccessfulIngestAt ? "success" : "neutral"} />
            <MetricCard label="Current Processing" value={data.metrics.currentProcessingCount} hint="Live workers claiming rows" tone="neutral" />
          </div>
        </SectionBlock>

        <SectionBlock
          title="Important Activity"
          subtitle="High-signal events only. No sender, subject, body, or raw headers."
        >
          {!hasActivity ? (
            <EmptyState
              title="No high-priority activity yet."
              description="Offer, interview, assessment, recruiter reply, follow-up, and review items will appear here."
            />
          ) : (
            <div className="coo-activity-list">
              {data.activityRows.map((item) => {
                const deadline = formatDeadline(item.deadline);
                return (
                  <article key={item.id} className="coo-activity-card">
                    <div className="coo-activity-card__top">
                      <div className="coo-chip-row">
                        <CooBadge label={item.category ?? "review"} tone={toneForCategory(item.category)} />
                        <CooBadge label={item.queueStatusLabel} tone={toneForQueue(item.classificationStatus)} />
                        <CooBadge label={item.priority} tone={item.priority === "offer" ? "offer" : item.priority === "review" ? "review" : "neutral"} />
                      </div>
                      <time className="coo-activity-time" dateTime={item.receivedAt}>
                        {formatDateTime(item.receivedAt)}
                      </time>
                    </div>
                    <div className="coo-activity-recipient">{item.originalRecipient ?? "Unmapped recipient"}</div>
                    <div className="coo-activity-meta">
                      {deadline ? <span>Deadline: {deadline}</span> : null}
                      {item.actionRequired ? <span>Action: {item.actionRequired}</span> : null}
                    </div>
                    {item.classificationStatus === "review" ? (
                      <div className="coo-review-note">
                        <CooBadge label="Review" tone="review" />
                        <p>{item.safeReason ?? "Classification reason redacted for safety."}</p>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </SectionBlock>
      </div>

      <SectionBlock
        title="Two-stage Processing Flow"
        subtitle="A concise COO-facing summary of how the tracker works."
      >
        <div className="coo-flow">
          {[
            "Incoming Email",
            "Tracker Inbox",
            "Awaiting Classification",
            "Rules / AI Classification",
            "Client Activity View",
            "Review Queue when required",
          ].map((step, index) => (
            <div key={step} className="coo-flow__step">
              <span className="coo-flow__index">{index + 1}</span>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </SectionBlock>

    </main>
  );
}
