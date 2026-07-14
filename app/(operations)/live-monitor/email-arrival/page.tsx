import { IconClients, IconMail, IconRefresh, IconWarning } from "@/components/icons";
import { EmptyState, MetricCard, SectionBlock } from "@/components/coo";
import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
import { getEmailArrivalMonitorData, formatIstTime } from "@/lib/zoho/emailArrival";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EmailArrivalMonitorPage() {
  await requireDashboardSession();

  const result = await getEmailArrivalMonitorData();

  return (
    <main className="coo-page coo-live-monitor-page">
      <meta httpEquiv="refresh" content="20" />
      <header className="coo-page__header">
        <div>
          <span className="coo-page__eyebrow">Live Monitor</span>
          <h1 className="coo-page__title">Live Email Arrival Monitor</h1>
          <p className="coo-page__subtitle">
            Real-time view of emails arriving in tracker today (12:00 AM – 11:59 PM IST)
          </p>
        </div>
      </header>

      {!result.ok ? (
        <EmptyState
          title="Live monitor data unavailable."
          description="Please refresh again in a moment."
        />
      ) : (
        <>
          <div className="coo-metric-grid--live-monitor">
            <MetricCard
              label="Total Emails Today"
              value={result.data.totalEmailsToday}
              hint="Grouped across all tracker mailboxes"
              icon={<IconMail size={18} />}
            />
            <MetricCard
              label="Latest Email Time"
              value={formatIstTime(result.data.latestEmailAt)}
              hint="Latest arrival in IST"
              icon={<IconRefresh size={18} />}
            />
            <MetricCard
              label="Active Mailboxes Today"
              value={result.data.activeMailboxesToday}
              hint="Mailboxes that received at least one email"
              icon={<IconClients size={18} />}
            />
            <MetricCard
              label="Silent Mailboxes Today"
              value="Not tracked yet"
              hint="Phase 1 has no mailbox roster to compare against"
              icon={<IconWarning size={18} />}
            />
          </div>

          <SectionBlock title="Email Arrival by Client Mailbox">
            <div className="coo-table-card">
              {result.data.rows.length === 0 ? (
                <EmptyState
                  title="No emails received today."
                  description="No tracker emails have been received since 12:00 AM today."
                />
              ) : (
                <table className="coo-table">
                  <thead>
                    <tr>
                      <th>Client Mailbox</th>
                      <th>Client Name</th>
                      <th>Assigned CA</th>
                      <th>CA Email</th>
                      <th>Emails Today</th>
                      <th>Latest Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.rows.map((row) => (
                      <tr key={row.originalRecipient}>
                        <td>{row.originalRecipient}</td>
                        <td>{row.clientName}</td>
                        <td>{row.assignedCaName}</td>
                        <td>{row.assignedCaEmail}</td>
                        <td>{row.emailsToday}</td>
                        <td>{formatIstTime(row.latestEmailAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </SectionBlock>
        </>
      )}
    </main>
  );
}
