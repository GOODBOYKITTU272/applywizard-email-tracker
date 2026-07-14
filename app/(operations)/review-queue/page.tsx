import Link from "next/link";

import { CooBadge, EmptyState, MetricCard, SectionBlock } from "@/components/coo";
import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
import { getReviewQueueWorkspaceData } from "@/lib/zoho/cooWorkspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDateTime(value: string): string {
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

export default async function ReviewQueuePage() {
  await requireDashboardSession();

  const data = await getReviewQueueWorkspaceData();

  return (
    <main className="coo-page coo-review-page">
      <header className="coo-page__header">
        <div>
          <span className="coo-page__eyebrow">Review Queue</span>
          <h1 className="coo-page__title">Safe Manual Review Workbench</h1>
          <p className="coo-page__subtitle">
            Only classification_status = review. No raw body, subject, headers, OTP, or links.
          </p>
        </div>
        <div className="coo-page__meta">
          <CooBadge label={`${data.count} review items`} tone={data.count ? "review" : "neutral"} />
        </div>
      </header>

      <SectionBlock title="Review Summary" subtitle="Human review only. Read-only in Phase 1.">
        <div className="coo-metric-grid coo-metric-grid--review">
          <MetricCard label="Review Items" value={data.count} hint="classification_status = review" tone="review" />
          <MetricCard label="Open Client Actions" value={data.rows.filter((row) => row.actionRequired).length} hint="Emails with a safe action hint" tone="warning" />
          <MetricCard label="Deadlines" value={data.rows.filter((row) => row.deadline).length} hint="Items with a deadline" tone="assessment" />
          <MetricCard label="High Confidence" value={data.rows.filter((row) => typeof row.confidence === "number" && row.confidence >= 0.75).length} hint="Confidence at or above threshold" tone="success" />
        </div>
      </SectionBlock>

      <SectionBlock title="Review Queue" subtitle="Safe fields only. No mutating action buttons in this phase.">
        {!data.rows.length ? (
          <EmptyState title="No review emails available." description="The review queue is empty right now." />
        ) : (
          <>
            <div className="coo-table-card">
              <table className="coo-table coo-table--review">
                <thead>
                  <tr>
                    <th>Client Identity</th>
                    <th>Suggested Category</th>
                    <th>Confidence</th>
                    <th>Safe Reason</th>
                    <th>Received Time</th>
                    <th>Queue Age</th>
                    <th>Deadline / Action Required</th>
                    <th>Open Client</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="coo-client-cell">
                        <Link href={`/clients/${row.clientKey}`} className="coo-client-link">{row.originalRecipient ?? "Client mailbox not identified"}</Link>
                        <span className="coo-client-note">Temporary identity</span>
                      </td>
                      <td><CooBadge label={row.suggestedCategory ?? "unknown"} tone="review" /></td>
                      <td>{typeof row.confidence === "number" ? `${(row.confidence * 100).toFixed(0)}%` : "—"}</td>
                      <td className="coo-review-reason">{row.safeReason ?? "Classification reason redacted for safety."}</td>
                      <td>{formatDateTime(row.receivedAt)}</td>
                      <td>{row.queueAgeLabel}</td>
                      <td className="coo-review-action">
                        {row.deadline ? <span>Deadline: {formatDeadline(row.deadline)}</span> : null}
                        {row.actionRequired ? <span>Action: {row.actionRequired}</span> : null}
                      </td>
                      <td><Link href={`/clients/${row.clientKey}`} className="coo-inline-link">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="coo-mobile-grid">
              {data.rows.map((row) => (
                <article key={row.id} className="coo-mobile-card">
                  <div className="coo-mobile-card__top">
                    <div>
                      <div className="coo-mobile-card__title">{row.originalRecipient ?? "Client mailbox not identified"}</div>
                      <div className="coo-mobile-card__subtitle">{row.queueAgeLabel} · {formatDateTime(row.receivedAt)}</div>
                    </div>
                    <div className="coo-chip-stack">
                      <CooBadge label={row.suggestedCategory ?? "unknown"} tone="review" />
                      <CooBadge label={`${typeof row.confidence === "number" ? (row.confidence * 100).toFixed(0) : "—"}%`} tone="review" />
                    </div>
                  </div>
                  <div className="coo-review-reason">{row.safeReason ?? "Classification reason redacted for safety."}</div>
                  <div className="coo-mobile-card__stats">
                    <span>{row.deadline ? `Deadline ${formatDeadline(row.deadline)}` : "No deadline"}</span>
                    <span>{row.actionRequired ?? "No action hint"}</span>
                  </div>
                  <Link href={`/clients/${row.clientKey}`} className="coo-inline-link">Open Client</Link>
                </article>
              ))}
            </div>
          </>
        )}
      </SectionBlock>

    </main>
  );
}
