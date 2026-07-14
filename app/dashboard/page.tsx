import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  await requireDashboardSession();

  const expectedSecret = process.env.DASHBOARD_SECRET;


  // Fail closed: require DASHBOARD_SECRET to be configured on the server
  if (!expectedSecret) {
    return (
      <main className="dashboard-wrapper">
        <div className="orb orb-primary" aria-hidden="true" />
        <div className="grid-overlay" aria-hidden="true" />
        <div className="state-card error-card">
          <span className="state-icon">⚠️</span>
          <h3>Configuration Error</h3>
          <p>
            DASHBOARD_SECRET is not configured on the server. Access blocked.
          </p>
        </div>
        <style>{`
          .dashboard-wrapper {
            position: relative;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem 1.25rem;
            overflow: hidden;
            background: #0a0c10;
            color: #f0f2f8;
            font-family: 'Inter', sans-serif;
          }
          .orb {
            position: absolute;
            border-radius: 50%;
            filter: blur(95px);
            opacity: 0.3;
            pointer-events: none;
            width: 550px;
            height: 550px;
          }
          .orb-primary {
            background: radial-gradient(circle, #6c63ff 0%, transparent 70%);
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
          }
          .grid-overlay {
            position: absolute;
            inset: 0;
            background-image:
              linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px);
            background-size: 52px 52px;
            pointer-events: none;
            mask-image: radial-gradient(ellipse 85% 75% at 50% 50%, black 40%, transparent 100%);
          }
          .state-card {
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            gap: 1rem;
            padding: 4rem 2rem;
            border-radius: 16px;
            border: 1px solid rgba(239, 68, 68, 0.2);
            background: rgba(239, 68, 68, 0.02);
            backdrop-filter: blur(12px);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
          }
          .state-icon {
            font-size: 3rem;
          }
          .state-card h3 {
            font-family: 'Space Grotesk', sans-serif;
            font-size: 1.5rem;
            font-weight: 600;
            color: #f1f5f9;
          }
          .state-card p {
            color: #94a3b8;
            font-size: 0.95rem;
            max-width: 380px;
            line-height: 1.6;
          }
        `}</style>
      </main>
    );
  }


  interface EmailRecord {
    received_at: string;
    mailbox_email: string;
    sender: string;
    subject: string;
    folder_name: string;
    category: string | null;
    confidence: number | null;
    source_portal: string | null;
    needs_human_review: boolean | null;
    action_required: string | null;
    deadline: string | null;
    classification_status: string;
    updated_at: string;
  }

  let emails: EmailRecord[] = [];
  let dbError = "";

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("zoho_email_metadata")
      .select(`
        received_at,
        mailbox_email,
        sender,
        subject,
        folder_name,
        category,
        confidence,
        source_portal,
        needs_human_review,
        action_required,
        deadline,
        classification_status,
        updated_at
      `)
      // exclude outgoing copies; keep NULL rows (pre-migration records)
      .or("email_direction.eq.incoming,email_direction.is.null")
      .order("received_at", { ascending: false })
      .limit(50);

    if (error) {
      dbError = error.message;
    } else {
      emails = (data || []) as unknown as EmailRecord[];
    }
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }


  return (
    <main className="dashboard-wrapper">
      {/* Glow Orbs */}
      <div className="orb orb-primary" aria-hidden="true" />
      <div className="orb orb-secondary" aria-hidden="true" />
      
      {/* Grid noise overlay */}
      <div className="grid-overlay" aria-hidden="true" />

      <div className="dashboard-content">
        <header className="dashboard-header">
          <div className="header-meta">
            <span className="badge">
              <span className="badge-dot" />
              Live Workspace
            </span>
            <h1 className="dashboard-title">Email Tracker Dashboard</h1>
            <p className="dashboard-subtitle">
              Displaying the latest 50 synced Zoho email records and AI classifications.
            </p>
          </div>
        </header>

        {dbError ? (
          <div className="state-card error-card">
            <span className="state-icon">⚠️</span>
            <h3>Database Error</h3>
            <p>{dbError}</p>
          </div>
        ) : emails.length === 0 ? (
          <div className="state-card empty-card">
            <span className="state-icon">📂</span>
            <h3>No Emails Found</h3>
            <p>Emails will appear here once the sync workflow is executed.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="glass-table">
              <thead>
                <tr>
                  <th>Received At</th>
                  <th>Mailbox / Sender</th>
                  <th>Subject</th>
                  <th>Portal / Folder</th>
                  <th>Category / Conf</th>
                  <th>Review</th>
                  <th>Status</th>
                  <th>Action Required / Deadline</th>
                </tr>
              </thead>
              <tbody>
                {emails.map((email, idx) => {
                  const receivedDate = new Date(email.received_at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    dateStyle: "medium",
                    timeStyle: "short",
                  });

                  return (
                    <tr key={idx} className="table-row">
                      <td className="cell-date">
                        <span className="date-text">{receivedDate}</span>
                      </td>
                      <td className="cell-sender">
                        <div className="mailbox-lbl">{email.mailbox_email}</div>
                        <div className="sender-lbl" title={email.sender}>
                          {email.sender}
                        </div>
                      </td>
                      <td className="cell-subject" title={email.subject}>
                        {email.subject}
                      </td>
                      <td className="cell-portal">
                        <span className="portal-badge">{email.source_portal || "unknown"}</span>
                        <div className="folder-text">{email.folder_name}</div>
                      </td>
                      <td className="cell-category">
                        {email.category ? (
                          <div className="category-container">
                            <span className="category-lbl">{email.category}</span>
                            <span className="confidence-lbl">
                              {(Number(email.confidence || 0) * 100).toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="unclassified-lbl">—</span>
                        )}
                      </td>
                      <td className="cell-review">
                        {email.needs_human_review ? (
                          <span className="badge-review needs-review">⚠️ Review</span>
                        ) : (
                          <span className="badge-review auto-ok">Auto</span>
                        )}
                      </td>
                      <td className="cell-status">
                        <span className={`status-tag status-${email.classification_status}`}>
                          {email.classification_status}
                        </span>
                      </td>
                      <td className="cell-action">
                        {email.action_required ? (
                          <div className="action-txt">{email.action_required}</div>
                        ) : (
                          <div className="action-none">—</div>
                        )}
                        {email.deadline && (
                          <div className="deadline-lbl">
                            📅 {new Date(email.deadline).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        /* ── Layout & Background ── */
        .dashboard-wrapper {
          position: relative;
          min-height: 100vh;
          padding: 3rem 2rem;
          overflow: hidden;
          background: #0a0c10;
          color: #f0f2f8;
          font-family: 'Inter', sans-serif;
        }

        @media (max-width: 768px) {
          .dashboard-wrapper {
            padding: 1.5rem 1rem;
          }
        }

        /* ── Ambient Orbs ── */
        .orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(95px);
          opacity: 0.3;
          pointer-events: none;
          animation: float 10s ease-in-out infinite alternate;
        }
        .orb-primary {
          width: 550px;
          height: 550px;
          background: radial-gradient(circle, #6c63ff 0%, transparent 70%);
          top: -150px;
          left: -150px;
        }
        .orb-secondary {
          width: 450px;
          height: 450px;
          background: radial-gradient(circle, #a78bfa 0%, transparent 70%);
          bottom: -150px;
          right: -150px;
          animation-delay: -3s;
        }
        @keyframes float {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(25px, 20px) scale(1.05); }
        }

        /* ── Grid Overlay ── */
        .grid-overlay {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px);
          background-size: 52px 52px;
          pointer-events: none;
          mask-image: radial-gradient(ellipse 85% 75% at 50% 40%, black 40%, transparent 100%);
        }

        /* ── Main Container ── */
        .dashboard-content {
          position: relative;
          z-index: 1;
          max-width: 1360px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 2.5rem;
        }

        /* ── Header ── */
        .dashboard-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
        }
        .dashboard-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 2.5rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          background: linear-gradient(135deg, #f0f2f8 0%, #c7c4ff 70%, #a78bfa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .dashboard-subtitle {
          color: #9098b0;
          font-size: 1rem;
          margin-top: 0.5rem;
        }

        /* ── Badge ── */
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          border-radius: 9999px;
          border: 1px solid rgba(108, 99, 255, 0.3);
          background: rgba(108, 99, 255, 0.08);
          font-size: 0.75rem;
          font-weight: 500;
          color: #a78bfa;
          margin-bottom: 0.75rem;
        }
        .badge-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #6ee7b7;
          box-shadow: 0 0 6px #6ee7b7;
        }

        /* ── Table Container & Glass styling ── */
        .table-container {
          width: 100%;
          overflow-x: auto;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          background: rgba(255, 255, 255, 0.02);
          backdrop-filter: blur(12px);
          box-shadow: 0 15px 35px rgba(0, 0, 0, 0.3);
        }
        .glass-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.875rem;
        }
        .glass-table th {
          padding: 16px 20px;
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          color: #9098b0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.01);
          letter-spacing: 0.02em;
        }
        .glass-table td {
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          vertical-align: middle;
        }
        .table-row {
          transition: background-color 0.2s ease;
        }
        .table-row:hover {
          background-color: rgba(108, 99, 255, 0.04);
        }

        /* ── Specific Cells ── */
        .cell-date {
          white-space: nowrap;
          color: #9098b0;
        }
        .cell-sender {
          max-width: 200px;
        }
        .mailbox-lbl {
          font-size: 0.75rem;
          color: #555d75;
          margin-bottom: 2px;
        }
        .sender-lbl {
          font-weight: 500;
          color: #e2e8f0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cell-subject {
          max-width: 250px;
          font-weight: 500;
          color: #f1f5f9;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        .portal-badge {
          display: inline-block;
          font-size: 0.75rem;
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.05);
          color: #94a3b8;
          text-transform: uppercase;
          font-weight: 600;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .folder-text {
          font-size: 0.75rem;
          color: #64748b;
          margin-top: 4px;
        }

        .category-container {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .category-lbl {
          font-weight: 600;
          color: #c7c4ff;
        }
        .confidence-lbl {
          font-size: 0.75rem;
          color: #a78bfa;
        }
        .unclassified-lbl {
          color: #475569;
        }

        /* ── Status Badges ── */
        .badge-review {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .badge-review.needs-review {
          background: rgba(245, 158, 11, 0.15);
          color: #f59e0b;
          border: 1px solid rgba(245, 158, 11, 0.25);
        }
        .badge-review.auto-ok {
          background: rgba(255, 255, 255, 0.04);
          color: #64748b;
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .status-tag {
          display: inline-flex;
          padding: 4px 10px;
          border-radius: 8px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .status-tag.status-classified {
          background: rgba(16, 185, 129, 0.12);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.25);
        }
        .status-tag.status-pending {
          background: rgba(245, 158, 11, 0.12);
          color: #f59e0b;
          border: 1px solid rgba(245, 158, 11, 0.25);
          animation: pulse 2s ease-in-out infinite;
        }
        .status-tag.status-processing {
          background: rgba(59, 130, 246, 0.12);
          color: #60a5fa;
          border: 1px solid rgba(59, 130, 246, 0.25);
        }
        .status-tag.status-retry_scheduled {
          background: rgba(245, 158, 11, 0.12);
          color: #f59e0b;
          border: 1px solid rgba(245, 158, 11, 0.25);
        }
        .status-tag.status-review {
          background: rgba(251, 191, 36, 0.12);
          color: #fbbf24;
          border: 1px solid rgba(251, 191, 36, 0.25);
        }
        .status-tag.status-failed {
          background: rgba(239, 68, 68, 0.12);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.25);
        }
        .status-tag.status-dead_letter {
          background: rgba(239, 68, 68, 0.12);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.25);
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }

        /* ── Action Required & Deadline ── */
        .cell-action {
          max-width: 250px;
        }
        .action-txt {
          color: #cbd5e1;
          line-height: 1.4;
          font-size: 0.8rem;
        }
        .action-none {
          color: #475569;
        }
        .deadline-lbl {
          display: inline-flex;
          align-items: center;
          margin-top: 6px;
          font-size: 0.75rem;
          font-weight: 600;
          color: #fca5a5;
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.15);
          padding: 2px 6px;
          border-radius: 4px;
        }

        /* ── State Cards ── */
        .state-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 1rem;
          padding: 6rem 2rem;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          background: rgba(255, 255, 255, 0.02);
          backdrop-filter: blur(12px);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        }
        .state-icon {
          font-size: 3rem;
        }
        .state-card h3 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 1.5rem;
          font-weight: 600;
          color: #f1f5f9;
        }
        .state-card p {
          color: #94a3b8;
          font-size: 0.95rem;
          max-width: 380px;
          line-height: 1.6;
        }
        .error-card {
          border-color: rgba(239, 68, 68, 0.2);
          background: rgba(239, 68, 68, 0.02);
        }
      `}</style>
    </main>
  );
}
