import Link from "next/link";

import { CooBadge, EmptyState, MetricCard, SectionBlock } from "@/components/coo";
import { requireOperationsAccess } from "@/lib/dashboardAuth/requireOperationsAccess";
import { getOperationsWorkspaceData } from "@/lib/zoho/cooWorkspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDateTime(value: string | null): string {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export default async function OperationsPage() {
  await requireOperationsAccess();

  const data = await getOperationsWorkspaceData();

  return (
    <main className="coo-page coo-operations-page">
      <header className="coo-page__header">
        <div>
          <span className="coo-page__eyebrow">Operations</span>
          <h1 className="coo-page__title">Queue Health and Backlog Diagnostics</h1>
          <p className="coo-page__subtitle">
            Live queue health for email processing. Detailed processing health will appear when heartbeat reporting is available.
          </p>
        </div>
        <div className="coo-page__meta">
          <CooBadge label={`Latest ingest: ${formatDateTime(data.latestSuccessfulIngestAt)}`} tone={data.latestSuccessfulIngestAt ? "success" : "neutral"} />
          <CooBadge label={data.oldestBacklogAgeMinutes === null ? "Oldest backlog: —" : `Oldest backlog: ${data.oldestBacklogAgeMinutes}m`} tone="warning" />
        </div>
      </header>

      <SectionBlock title="Queue Cards" subtitle="Pending, processing, retries, review, and dead letters.">
        <div className="coo-metric-grid coo-metric-grid--operations">
          <MetricCard label="Pending" value={data.pending} hint="Awaiting classification" tone="warning" />
          <MetricCard label="Processing" value={data.processing} hint="Currently in progress" tone="neutral" />
          <MetricCard label="Retry Scheduled" value={data.retryScheduled} hint="Waiting for next attempt" tone="warning" />
          <MetricCard label="Review" value={data.review} hint="Human review" tone="review" />
          <MetricCard label="Dead Letter" value={data.deadLetter} hint="Stopped safely" tone="critical" />
          <MetricCard label="Oldest Backlog Age" value={data.oldestBacklogAgeMinutes === null ? "—" : `${data.oldestBacklogAgeMinutes}m`} hint="Based on when the email entered the system" tone="warning" />
          <MetricCard label="Latest Successful Ingest" value={formatDateTime(data.latestSuccessfulIngestAt)} hint="From the tracker mailbox" tone={data.latestSuccessfulIngestAt ? "success" : "neutral"} />
          <MetricCard label="Current Processing Count" value={data.currentProcessingCount} hint="Emails currently being processed" tone="neutral" />
        </div>
      </SectionBlock>

      <div className="coo-operations-grid">
        <SectionBlock title="Oldest Pending" subtitle="Oldest pending emails are shown first.">
          {data.oldestPending.length ? (
            <div className="coo-row-list">
              {data.oldestPending.map((row) => (
                <article key={row.id} className="coo-row-card">
                  <div className="coo-row-card__top">
                    <strong>{row.originalRecipient ?? "Client mailbox not identified"}</strong>
                    <CooBadge label="Pending" tone="warning" />
                  </div>
                  <div className="coo-row-card__meta">
                    <span>Age: {row.queueAgeLabel}</span>
                    <span>Received: {formatDateTime(row.receivedAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No pending emails." description="The pending queue is currently clear." />
          )}
        </SectionBlock>

        <SectionBlock title="Oldest Review" subtitle="Emails awaiting human attention.">
          {data.oldestReview.length ? (
            <div className="coo-row-list">
              {data.oldestReview.map((row) => (
                <article key={row.id} className="coo-row-card">
                  <div className="coo-row-card__top">
                    <strong>{row.originalRecipient ?? "Client mailbox not identified"}</strong>
                    <CooBadge label="Review" tone="review" />
                  </div>
                  <div className="coo-row-card__meta">
                    <span>Age: {row.queueAgeLabel}</span>
                    <span>Confidence: {typeof row.confidence === "number" ? `${(row.confidence * 100).toFixed(0)}%` : "—"}</span>
                    <span>Received: {formatDateTime(row.receivedAt)}</span>
                  </div>
                  {row.safeReason ? <p className="coo-row-card__reason">{row.safeReason}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No review emails." description="Human review queue is empty." />
          )}
        </SectionBlock>

        <SectionBlock title="Retry Scheduled" subtitle="Emails waiting for the next attempt.">
          {data.retryScheduledRows.length ? (
            <div className="coo-row-list">
              {data.retryScheduledRows.map((row) => (
                <article key={row.id} className="coo-row-card">
                  <div className="coo-row-card__top">
                    <strong>{row.originalRecipient ?? "Client mailbox not identified"}</strong>
                    <CooBadge label="Retrying" tone="warning" />
                  </div>
                  <div className="coo-row-card__meta">
                    <span>Age: {row.queueAgeLabel}</span>
                    <span>Next retry: {formatDateTime(row.nextRetryAt)}</span>
                    <span>Received: {formatDateTime(row.receivedAt)}</span>
                  </div>
                  {row.lastErrorCode ? <p className="coo-row-card__reason">Last error code: {row.lastErrorCode}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No retry emails." description="There are no scheduled retries right now." />
          )}
        </SectionBlock>

        <SectionBlock title="Dead Letter" subtitle="Newest first. Small and visible, never dominant.">
          {data.deadLetterRows.length ? (
            <div className="coo-row-list">
              {data.deadLetterRows.map((row) => (
                <article key={row.id} className="coo-row-card">
                  <div className="coo-row-card__top">
                    <strong>{row.originalRecipient ?? "Client mailbox not identified"}</strong>
                    <CooBadge label="Dead Letter" tone="critical" />
                  </div>
                  <div className="coo-row-card__meta">
                    <span>Received: {formatDateTime(row.receivedAt)}</span>
                    <span>Dead-lettered: {formatDateTime(row.deadLetteredAt)}</span>
                    <span>Age: {row.queueAgeLabel}</span>
                  </div>
                  {row.lastErrorCode ? <p className="coo-row-card__reason">Safe error code: {row.lastErrorCode}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No dead-letter emails." description="All retryable emails are still active." />
          )}
        </SectionBlock>
      </div>

      <SectionBlock title="Processing Health" subtitle="Detailed heartbeat reporting is not available yet.">
        <EmptyState
          title="Processing health will appear when heartbeat reporting is available."
          description="This phase keeps the field neutral instead of faking uptime."
          action={<Link href="/dashboard" className="coo-inline-link">Open technical dashboard</Link>}
        />
      </SectionBlock>

    </main>
  );
}
