import Link from "next/link";

import {
  formatBacklogAge,
  getOverviewDashboardData,
} from "@/lib/zoho/cooOverview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MetricCardProps = {
  label: string;
  value: number | string;
  hint: string;
  accent?: "offer" | "interview" | "review" | "neutral";
};

type SystemCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "warning" | "critical" | "success" | "review";
  badge?: string;
};

function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function formatReceivedAt(value: string): string {
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

function MetricCard({ label, value, hint, accent = "neutral" }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${accent}`}>
      <div className="metric-copy">
        <span className="metric-label">{label}</span>
        <strong className="metric-value">{value}</strong>
      </div>
      <p className="metric-hint">{hint}</p>
    </article>
  );
}

function SystemCard({ label, value, hint, tone = "neutral", badge }: SystemCardProps) {
  return (
    <article className={`system-card system-card--${tone}`}>
      <div className="system-card-top">
        <span className="system-label">{label}</span>
        {badge ? <span className="system-badge">{badge}</span> : null}
      </div>
      <strong className="system-value">{value}</strong>
      {hint ? <p className="system-hint">{hint}</p> : null}
    </article>
  );
}

function Badge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "critical" | "review" | "category";
}) {
  return <span className={`overview-badge overview-badge--${tone}`}>{label}</span>;
}

export default async function OverviewPage() {
  const now = new Date();
  const data = await getOverviewDashboardData({ now });
  const dateLabel = formatDateLabel(now);

  const hasImportantActivity = data.importantActivity.length > 0;
  const hasNoTodayEmails = data.metrics.emailsReceivedToday === 0;
  const hasNoReviewItems = data.queue.review === 0;
  const hasCheckpoint = Boolean(data.queue.latestSuccessfulIngestAt);

  return (
    <main className="overview-shell">
      <header className="overview-header">
        <div className="header-copy">
          <span className="eyebrow">Live COO Overview</span>
          <h1>Operations Overview</h1>
          <p>Live email intake and client activity</p>
        </div>
        <div className="header-meta">
          <div className="header-date">{dateLabel}</div>
          <div className="header-chip-row">
            <Badge label={`${data.metrics.classifiedToday} classified today`} tone="success" />
            <Badge label={`${data.queue.review} in review`} tone="review" />
          </div>
        </div>
      </header>

      <section className="section-block">
        <div className="section-head">
          <div>
            <h2>Today</h2>
            <p>Counts are based on received_at, with classified throughput shown separately.</p>
          </div>
        </div>
        <div className="metric-grid">
          <MetricCard
            label="Emails Received Today"
            value={data.metrics.emailsReceivedToday}
            hint="Fresh intake from the tracker mailbox"
            accent="neutral"
          />
          <MetricCard
            label="Applications"
            value={data.metrics.applicationReceivedToday}
            hint="Incoming application_received emails"
            accent="neutral"
          />
          <MetricCard
            label="Interviews"
            value={data.metrics.interviewInviteToday}
            hint="Invite volume today"
            accent="interview"
          />
          <MetricCard
            label="Assessments"
            value={data.metrics.assessmentToday}
            hint="Assessment requests today"
            accent="neutral"
          />
          <MetricCard
            label="Offers"
            value={data.metrics.jobOfferToday}
            hint="Highest-priority activity"
            accent="offer"
          />
          <MetricCard
            label="Rejections"
            value={data.metrics.rejectionToday}
            hint="Closed opportunities"
            accent="neutral"
          />
          <MetricCard
            label="Recruiter Replies"
            value={data.metrics.recruiterReplyToday}
            hint="Reply volume today"
            accent="neutral"
          />
          <MetricCard
            label="Needs Review"
            value={data.metrics.needsReview}
            hint="Manual attention required"
            accent="review"
          />
        </div>
      </section>

      <section className="section-block">
        <div className="section-head">
          <div>
            <h2>System Health</h2>
            <p>Queue state and ingestion freshness for the tracker pipeline.</p>
          </div>
          <Link href="/dashboard" className="subtle-link">
            Open technical dashboard
          </Link>
        </div>
        <div className="system-grid">
          <SystemCard label="Pending" value={data.queue.pending} tone="neutral" />
          <SystemCard label="Processing" value={data.queue.processing} tone="neutral" />
          <SystemCard label="Retrying" value={data.queue.retryScheduled} tone="warning" />
          <SystemCard
            label="Review Queue"
            value={data.queue.review}
            tone="review"
            hint={`Classified today: ${data.metrics.classifiedToday}`}
          />
          <SystemCard
            label="Dead Letter"
            value={data.queue.deadLetter}
            tone="critical"
            badge={data.queue.deadLetter > 0 ? "Attention" : "Small"}
          />
          <SystemCard
            label="Oldest Backlog Age"
            value={formatBacklogAge(data.queue.oldestBacklogAgeMinutes)}
            tone="warning"
            hint="Oldest pending or retrying item in the queue"
          />
          <SystemCard
            label="Latest Ingest Time"
            value={
              data.queue.latestSuccessfulIngestAt
                ? formatReceivedAt(data.queue.latestSuccessfulIngestAt)
                : "Not available yet"
            }
            tone={hasCheckpoint ? "success" : "neutral"}
            hint={hasCheckpoint ? "Latest successful sync checkpoint" : "Checkpoint not available yet"}
          />
        </div>
      </section>

      <section className="section-block">
        <div className="section-head">
          <div>
            <h2>Important Activity</h2>
            <p>High-signal events only. No sender, subject, body, or raw headers.</p>
          </div>
        </div>

        {!hasImportantActivity ? (
          <div className="empty-state">
            <strong>No high-priority activity yet.</strong>
            <p>Offer, interview, assessment, recruiter reply, follow-up, and review items will appear here.</p>
          </div>
        ) : (
          <div className="activity-list">
            {data.importantActivity.map((item) => {
              const deadline = formatDeadline(item.deadline);
              return (
                <article className="activity-card" key={item.id}>
                  <div className="activity-topline">
                    <div className="badge-row">
                      <Badge label={item.category ?? "unknown"} tone="category" />
                      <Badge
                        label={item.classificationStatus}
                        tone={item.classificationStatus === "review" ? "review" : "neutral"}
                      />
                      <Badge label={item.priority} tone={item.priority === "review" ? "review" : "neutral"} />
                    </div>
                    <time className="activity-time" dateTime={item.receivedAt}>
                      {formatReceivedAt(item.receivedAt)}
                    </time>
                  </div>

                  <div className="activity-identity">{item.originalRecipient ?? "Unmapped recipient"}</div>

                  <div className="activity-meta">
                    {deadline ? <span>Deadline: {deadline}</span> : null}
                    {item.actionRequired ? <span>Action: {item.actionRequired}</span> : null}
                  </div>

                  {item.classificationStatus === "review" ? (
                    <div className="review-note">
                      <Badge label="Review" tone="review" />
                      <p>{item.safeReason ?? "Classification reason redacted for safety."}</p>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="footer-grid">
        <div className="footer-card">
          <h3>Operational notes</h3>
          <ul>
            <li>Tracker mailbox stays hidden from the client identity layer.</li>
            <li>Review rows surface only safe reasons.</li>
            <li>Dead letter remains visible, but visually small.</li>
          </ul>
        </div>
        <div className="footer-card">
          <h3>Empty-state checks</h3>
          <ul>
            <li>{hasNoTodayEmails ? "No emails arrived today yet." : "Today has inbound email activity."}</li>
            <li>{hasNoReviewItems ? "No review items are waiting." : "Review items are currently waiting."}</li>
            <li>{hasCheckpoint ? "Latest ingest checkpoint is available." : "Latest ingest checkpoint is missing."}</li>
          </ul>
        </div>
      </section>

      <style>{`
        .overview-shell {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .overview-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
          padding: 24px;
          border: 1px solid var(--border-gray);
          border-radius: 20px;
          background: var(--white);
          box-shadow: var(--card-shadow);
        }

        .header-copy {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .eyebrow {
          font-size: 0.75rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--primary-blue);
        }

        .overview-header h1 {
          margin: 0;
          font-family: var(--font-space-grotesk), sans-serif;
          font-size: clamp(2rem, 3.5vw, 3rem);
          color: var(--text-dark);
          letter-spacing: -0.03em;
        }

        .overview-header p,
        .section-head p,
        .system-hint,
        .metric-hint,
        .empty-state p,
        .activity-meta,
        .footer-card li {
          color: var(--text-muted);
        }

        .header-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
        }

        .header-date {
          font-size: 0.95rem;
          color: var(--text-muted);
          text-align: right;
        }

        .header-chip-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .section-block {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .section-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 16px;
        }

        .section-head h2,
        .footer-card h3 {
          margin: 0;
          font-family: var(--font-space-grotesk), sans-serif;
          font-size: 1.3rem;
          color: var(--text-dark);
        }

        .subtle-link {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--primary-blue);
        }

        .metric-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }

        .metric-card,
        .system-card,
        .activity-card,
        .footer-card,
        .empty-state {
          border: 1px solid var(--border-gray);
          background: var(--white);
          border-radius: 18px;
          box-shadow: var(--card-shadow);
        }

        .metric-card {
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-height: 140px;
        }

        .metric-card--offer {
          border-color: rgba(16, 185, 129, 0.28);
          background: linear-gradient(180deg, rgba(16, 185, 129, 0.08), var(--white));
        }

        .metric-card--interview {
          border-color: rgba(245, 158, 11, 0.28);
          background: linear-gradient(180deg, rgba(245, 158, 11, 0.08), var(--white));
        }

        .metric-card--review {
          border-color: rgba(239, 68, 68, 0.24);
          background: linear-gradient(180deg, rgba(239, 68, 68, 0.06), var(--white));
        }

        .metric-copy {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .metric-label,
        .system-label {
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        .metric-value {
          font-family: var(--font-space-grotesk), sans-serif;
          font-size: clamp(2rem, 3vw, 2.6rem);
          line-height: 1;
          color: var(--text-dark);
        }

        .metric-hint {
          margin-top: auto;
          font-size: 0.875rem;
          line-height: 1.5;
        }

        .system-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }

        .system-card {
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 128px;
        }

        .system-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .system-value {
          font-family: var(--font-space-grotesk), sans-serif;
          font-size: clamp(1.5rem, 2.2vw, 2rem);
          color: var(--text-dark);
        }

        .system-card--warning {
          border-color: rgba(245, 158, 11, 0.24);
        }

        .system-card--critical {
          border-color: rgba(239, 68, 68, 0.24);
        }

        .system-card--success {
          border-color: rgba(16, 185, 129, 0.24);
        }

        .system-card--review {
          border-color: rgba(239, 68, 68, 0.24);
        }

        .system-badge {
          font-size: 0.72rem;
          font-weight: 700;
          padding: 4px 8px;
          border-radius: 9999px;
          background: #f8fafc;
          color: var(--text-muted);
        }

        .system-hint {
          font-size: 0.82rem;
          line-height: 1.45;
        }

        .activity-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .activity-card {
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .activity-topline {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .badge-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .overview-badge {
          display: inline-flex;
          align-items: center;
          border-radius: 9999px;
          padding: 5px 10px;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }

        .overview-badge--neutral {
          background: #f3f4f6;
          color: #475569;
        }

        .overview-badge--success {
          background: var(--success-green-bg);
          color: var(--success-green);
        }

        .overview-badge--warning {
          background: var(--pending-orange-bg);
          color: var(--pending-orange);
        }

        .overview-badge--critical {
          background: var(--urgent-red-bg);
          color: var(--urgent-red);
        }

        .overview-badge--review {
          background: rgba(239, 68, 68, 0.12);
          color: #dc2626;
        }

        .overview-badge--category {
          background: #eef2ff;
          color: #4f46e5;
        }

        .activity-time {
          font-size: 0.85rem;
          color: var(--text-muted);
          white-space: nowrap;
        }

        .activity-identity {
          font-family: var(--font-space-grotesk), sans-serif;
          font-size: 1rem;
          color: var(--text-dark);
          letter-spacing: -0.01em;
        }

        .activity-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          font-size: 0.875rem;
        }

        .review-note {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          border-radius: 14px;
          background: rgba(239, 68, 68, 0.05);
          border: 1px solid rgba(239, 68, 68, 0.12);
        }

        .review-note p {
          margin: 0;
          color: var(--text-dark);
          line-height: 1.5;
        }

        .empty-state {
          padding: 24px;
        }

        .empty-state strong {
          display: block;
          margin-bottom: 6px;
          font-family: var(--font-space-grotesk), sans-serif;
          font-size: 1rem;
          color: var(--text-dark);
        }

        .footer-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }

        .footer-card {
          padding: 18px;
        }

        .footer-card ul {
          margin: 12px 0 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        @media (max-width: 1024px) {
          .metric-grid,
          .system-grid,
          .footer-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .overview-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .header-meta {
            align-items: flex-start;
          }
        }

        @media (max-width: 640px) {
          .metric-grid,
          .system-grid,
          .footer-grid {
            grid-template-columns: 1fr;
          }

          .overview-header,
          .section-head,
          .activity-topline {
            flex-direction: column;
            align-items: flex-start;
          }

          .activity-time {
            white-space: normal;
          }
        }
      `}</style>
    </main>
  );
}
