"use client";

import React, { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mockClients, mockApplications } from "@/lib/mockData";
import { classifyApplications } from "@/lib/classify/classifyMockEmails";

interface PageProps {
  params: Promise<{ clientId: string }>;
}

export default function ClientDashboardPage({ params }: PageProps) {
  const router = useRouter();
  const resolvedParams = use(params);
  const clientId = resolvedParams.clientId;

  // Find client
  const client = mockClients.find((c) => c.id === clientId);

  // Derived classified applications for this client
  const clientApps = classifyApplications(
    mockApplications.filter((a) => a.clientId === clientId)
  );

  // Attention items (derived needs_human_review)
  const attentionItems = clientApps.filter((a) => a.derived.needs_human_review);

  // Derived metric counts
  const derivedAppCount = clientApps.filter((a) => a.derived.category === "application_received").length;
  const derivedInterviewCount = clientApps.filter((a) => a.derived.category === "interview_invite").length;
  const derivedAssessmentCount = clientApps.filter((a) => a.derived.category === "assessment").length;
  const derivedRejectionCount = clientApps.filter((a) => a.derived.category === "rejection").length;
  const derivedReviewCount = attentionItems.length;

  if (!client) {
    return (
      <div className="error-card">
        <h3>Client Not Found</h3>
        <p>The client record with ID &ldquo;{clientId}&rdquo; does not exist.</p>
        <Link href="/clients" className="btn btn-primary">
          Back to Clients & Mailboxes
        </Link>
      </div>
    );
  }

  return (
    <div className="client-dashboard-container">
      {/* ── Client Profile Header ── */}
      <header className="client-profile-header">
        <div className="profile-identity">
          <div className="avatar-large">{client.name.substring(0, 2).toUpperCase()}</div>
          <div className="identity-text">
            <div className="profile-top-row">
              <h1 className="profile-name">{client.name}</h1>
              <span className={`status-badge ${client.mailboxStatus === "Active" ? "healthy" : "needs_reconnect"}`}>
                {client.mailboxStatus === "Active" ? "● Connected & Active" : `● ${client.mailboxStatus}`}
              </span>
            </div>
            <p className="profile-subtext">
              Client Email: <strong>{client.email}</strong> · Zoho Mailbox: <strong>{client.mailbox}</strong>
            </p>
          </div>
        </div>

        <div className="profile-meta-details">
          <div className="meta-box">
            <span className="meta-lbl">Assigned Advisor</span>
            <strong className="meta-val">{client.caName}</strong>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => alert(`Syncing Zoho mailbox: ${client.mailbox}...`)}
          >
            🔄 Refresh Sync
          </button>
        </div>
      </header>

      {/* ── Metric Cards Grid ── */}
      <section className="metrics-grid">
        <div className="metric-card">
          <span className="metric-lbl">Total Emails</span>
          <div className="metric-val">{clientApps.length}</div>
          <span className="trend-lbl text-muted">All synced headers</span>
        </div>

        <div className="metric-card">
          <span className="metric-lbl">Applications</span>
          <div className="metric-val">{derivedAppCount}</div>
          <span className="trend-lbl text-success">Submitted</span>
        </div>

        <div className="metric-card">
          <span className="metric-lbl">Interviews</span>
          <div className="metric-val">{derivedInterviewCount}</div>
          <span className="trend-lbl text-success">Scheduled</span>
        </div>

        <div className="metric-card">
          <span className="metric-lbl">Assessments</span>
          <div className="metric-val">{derivedAssessmentCount}</div>
          <span className="trend-lbl text-pending">Deadlines pending</span>
        </div>

        <div className="metric-card">
          <span className="metric-lbl">Rejections</span>
          <div className="metric-val">{derivedRejectionCount}</div>
          <span className="trend-lbl text-muted">Closed postings</span>
        </div>

        <div className="metric-card highlight-urgent">
          <span className="metric-lbl">Review Required</span>
          <div className="metric-val text-urgent">{derivedReviewCount}</div>
          <span className="trend-lbl text-urgent font-bold">Needs CA review</span>
        </div>
      </section>

      {/* ── Main Layout Split ── */}
      <div className="client-main-layout">
        {/* Left Side: Attention Needed & Recent Emails */}
        <div className="layout-left">
          {/* Attention Items */}
          <div className="card-box">
            <div className="card-box-header">
              <h2>⚠️ Attention Required ({attentionItems.length})</h2>
              {attentionItems.length > 0 && (
                <Link href="/review-queue" className="box-action-link">
                  Open Review Queue →
                </Link>
              )}
            </div>

            {attentionItems.length === 0 ? (
              <div className="empty-state-small">
                ✓ No items require immediate attention for this client.
              </div>
            ) : (
              <div className="attention-list">
                {attentionItems.map((item) => (
                  <div key={item.id} className="attention-item">
                    <div className="item-top-row">
                      <span className={`badge badge-${item.derived.category}`}>
                        {item.derived.category.replace("_", " ")}
                      </span>
                      {item.derived.deadline && (
                        <span className="deadline-lbl font-tabular">Due: {item.derived.deadline}</span>
                      )}
                    </div>
                    <h4 className="item-subject">{item.subject}</h4>
                    <p className="item-action">
                      <strong>Task: </strong> {item.actionRequired}
                    </p>
                    <div className="item-actions-panel">
                      <button
                        className="action-btn"
                        onClick={() => router.push(`/applications/${item.id}`)}
                      >
                        Open Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Emails Log */}
          <div className="card-box">
            <div className="card-box-header">
              <h2>Recent Synced Emails</h2>
              <button
                className="box-action-link-btn"
                onClick={() => alert(`Opening all emails in workspace...`)}
              >
                Open All Emails
              </button>
            </div>

            {clientApps.length === 0 ? (
              <div className="empty-state-small">📂 No email history found for this client.</div>
            ) : (
              <>
                {/* Desktop view */}
                <div className="table-wrapper">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th>Subject</th>
                        <th>Sender</th>
                        <th>Received At</th>
                        <th>Category</th>
                        <th>Confidence</th>
                        <th>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientApps.map((app) => {
                        const dateFormatted = new Date(app.receivedDate).toLocaleDateString("en-IN", {
                          dateStyle: "medium",
                        });
                        return (
                          <tr
                            key={app.id}
                            className="table-row-clickable"
                            onClick={() => router.push(`/applications/${app.id}`)}
                          >
                            <td className="cell-subject">{app.subject}</td>
                            <td>{app.companyName || app.sender}</td>
                            <td className="font-tabular">{dateFormatted}</td>
                            <td>
                              <span className={`badge badge-${app.derived.category}`}>
                                {app.derived.category.replace("_", " ")}
                              </span>
                            </td>
                            <td className="font-tabular">{(app.derived.confidence * 100).toFixed(0)}%</td>
                            <td>
                              {app.derived.needs_human_review ? (
                                <span className="action-tag tag-urgent">Review</span>
                              ) : (
                                <span className="action-tag tag-success">Auto</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile view */}
                <div className="mobile-cards-list">
                  {clientApps.map((app) => (
                    <div
                      key={app.id}
                      className="mobile-log-card"
                      onClick={() => router.push(`/applications/${app.id}`)}
                    >
                      <div className="mobile-log-header">
                        <span className={`badge badge-${app.derived.category}`}>
                          {app.derived.category.replace("_", " ")}
                        </span>
                        {app.derived.needs_human_review && (
                          <span className="action-tag tag-urgent">Review</span>
                        )}
                      </div>
                      <div className="mobile-log-subject">{app.subject}</div>
                      <div className="mobile-log-meta">
                        <span>{app.companyName || app.sender}</span>
                        <span className="font-tabular">
                          {new Date(app.receivedDate).toLocaleDateString("en-IN")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Side: CA details & Info */}
        <div className="layout-right">
          <div className="card-box">
            <h2>Operations Details</h2>
            <div className="ops-details-list">
              <div className="detail-row">
                <span className="detail-label">Client ID</span>
                <span className="detail-value font-tabular">{client.id}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Assigned Advisor</span>
                <span className="detail-value">{client.caName}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Total Emails Today</span>
                <span className="detail-value font-tabular">{client.emailsToday}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Pending Classification</span>
                <span className="detail-value font-tabular">{client.pendingClassification}</span>
              </div>
            </div>
          </div>

          <div className="card-box">
            <h2>Quick Shortcuts</h2>
            <div className="shortcuts-list">
              <Link href="/applications" className="shortcut-item">
                📁 Browse Client Applications
              </Link>
              <Link href="/review-queue" className="shortcut-item">
                📥 Client Review Queue
              </Link>
              <Link href="/clients" className="shortcut-item">
                👥 Manage All Clients
              </Link>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .client-dashboard-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* ── Client Profile Header ── */
        .client-profile-header {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 20px;
          box-shadow: var(--card-shadow);
        }

        .profile-identity {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .avatar-large {
          width: 56px;
          height: 56px;
          background-color: var(--navy-sidebar);
          color: #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 1.25rem;
          border: 2px solid var(--border-gray);
        }

        .identity-text {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .profile-top-row {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .profile-name {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 1.6rem;
          font-weight: 700;
          color: var(--text-dark);
        }

        .status-badge {
          display: inline-flex;
          padding: 2px 10px;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .status-badge.healthy {
          background-color: var(--success-green-bg);
          color: var(--success-green);
        }

        .status-badge.needs_reconnect {
          background-color: var(--pending-orange-bg);
          color: var(--pending-orange);
        }

        .profile-subtext {
          font-size: 0.875rem;
          color: var(--text-muted);
        }

        .profile-subtext strong {
          color: var(--text-dark);
          font-weight: 500;
        }

        .profile-meta-details {
          display: flex;
          align-items: center;
          gap: 24px;
        }

        .meta-box {
          display: flex;
          flex-direction: column;
          gap: 4px;
          text-align: right;
        }

        .meta-lbl {
          font-size: 0.75rem;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 600;
        }

        .meta-val {
          font-size: 0.9375rem;
          color: var(--text-dark);
        }

        /* ── Metric Cards Grid ── */
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 16px;
        }

        .metric-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          box-shadow: var(--card-shadow);
        }

        .metric-card.highlight-urgent {
          border-left: 4px solid var(--urgent-red);
        }

        .metric-lbl {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-muted);
        }

        .metric-val {
          font-size: 1.75rem;
          font-weight: 700;
        }

        .trend-lbl {
          font-size: 0.75rem;
        }

        .text-success { color: var(--success-green); }
        .text-pending { color: var(--pending-orange); }
        .text-urgent { color: var(--urgent-red); }
        .font-bold { font-weight: 700; }
        .font-tabular { font-feature-settings: "tnum"; }

        /* ── Main Split Layout ── */
        .client-main-layout {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 24px;
        }

        .layout-left,
        .layout-right {
          display: flex;
          flex-direction: column;
          gap: 24px;
          min-width: 0;
        }

        .card-box {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 24px;
          box-shadow: var(--card-shadow);
        }

        .card-box h2 {
          font-size: 1rem;
          font-weight: 700;
          color: var(--text-dark);
          border-bottom: 1px solid var(--border-gray);
          padding-bottom: 10px;
          margin-bottom: 16px;
        }

        .card-box-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border-gray);
          padding-bottom: 10px;
          margin-bottom: 16px;
        }

        .card-box-header h2 {
          border: none;
          margin: 0;
          padding: 0;
        }

        .box-action-link {
          font-size: 0.8125rem;
          color: var(--primary-blue);
          text-decoration: none;
          font-weight: 600;
        }

        .box-action-link:hover {
          text-decoration: underline;
        }

        .box-action-link-btn {
          background: none;
          border: none;
          font-size: 0.8125rem;
          color: var(--primary-blue);
          font-weight: 600;
          cursor: pointer;
        }

        .box-action-link-btn:hover {
          text-decoration: underline;
        }

        /* Reusable button and badges */
        .btn {
          padding: 8px 16px;
          font-size: 0.875rem;
          font-weight: 600;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .btn-secondary { background-color: var(--white); border: 1px solid var(--border-gray); color: var(--text-dark); }
        .btn-secondary:hover { background-color: var(--workspace-bg); }
        .btn-primary { background-color: var(--primary-blue); color: var(--white); text-decoration: none; display: inline-flex; }

        .badge {
          display: inline-flex;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
        }
        .badge-interview_invite { background-color: var(--pending-orange-bg); color: var(--pending-orange); }
        .badge-assessment { background-color: var(--urgent-red-bg); color: var(--urgent-red); }
        .badge-recruiter_reply, .badge-follow_up_needed { background-color: var(--pending-orange-bg); color: var(--pending-orange); }
        .badge-application_received { background-color: #e2e8f0; color: var(--text-muted); }
        .badge-rejection { background-color: #fee2e2; color: #ef4444; }
        .badge-job_offer { background-color: var(--success-green-bg); color: var(--success-green); }
        .badge-email_verification, .badge-otp_verification { background-color: #dbeafe; color: var(--primary-blue); }

        .action-tag {
          display: inline-flex;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 600;
        }
        .tag-urgent { background-color: var(--urgent-red-bg); color: var(--urgent-red); }
        .tag-success { background-color: var(--success-green-bg); color: var(--success-green); }

        /* Attention Queue List */
        .attention-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .attention-item {
          padding: 16px;
          border: 1px solid var(--border-gray);
          border-radius: 8px;
          background-color: var(--workspace-bg);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .item-top-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .deadline-lbl {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--urgent-red);
        }

        .item-subject {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-dark);
        }

        .item-action {
          font-size: 0.8125rem;
          color: var(--text-muted);
        }

        .item-actions-panel {
          margin-top: 4px;
          border-top: 1px solid var(--border-gray);
          padding-top: 8px;
          display: flex;
          justify-content: flex-end;
        }

        .action-btn {
          background: none;
          border: none;
          color: var(--primary-blue);
          font-size: 0.8125rem;
          font-weight: 600;
          cursor: pointer;
        }

        .action-btn:hover {
          text-decoration: underline;
        }

        /* ── Table Styling ── */
        .table-wrapper {
          width: 100%;
          overflow-x: auto;
        }

        .ops-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.875rem;
        }

        .ops-table th {
          padding: 12px 16px;
          color: var(--text-muted);
          font-weight: 600;
          border-bottom: 1px solid var(--border-gray);
        }

        .ops-table td {
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-gray);
        }

        .table-row-clickable {
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .table-row-clickable:hover {
          background-color: var(--workspace-bg);
        }

        .cell-subject {
          max-width: 220px;
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
          font-weight: 600;
        }

        /* ── Right Panel Details ── */
        .ops-details-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .detail-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.875rem;
        }

        .detail-label {
          color: var(--text-muted);
          font-weight: 500;
        }

        .detail-value {
          color: var(--text-dark);
          font-weight: 600;
        }

        .shortcuts-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .shortcut-item {
          display: block;
          padding: 12px;
          background-color: var(--workspace-bg);
          border: 1px solid var(--border-gray);
          border-radius: 8px;
          color: var(--text-dark);
          text-decoration: none;
          font-size: 0.8125rem;
          font-weight: 600;
          transition: background-color 0.2s, border-color 0.2s;
        }

        .shortcut-item:hover {
          background-color: var(--white);
          border-color: var(--primary-blue);
        }

        /* Empty states */
        .empty-state-small {
          font-size: 0.8125rem;
          color: var(--text-muted);
          text-align: center;
          padding: 24px;
          border: 1px dashed var(--border-gray);
          border-radius: 8px;
        }

        .mobile-cards-list {
          display: none;
        }

        /* ── Responsive Rules ── */

        /* Laptop (1024px - 1439px) */
        @media (max-width: 1439px) {
          .metrics-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        /* Tablet (768px - 1023px) */
        @media (max-width: 1023px) {
          .client-main-layout {
            grid-template-columns: 1fr; /* Stack columns */
          }
        }

        /* Mobile (Below 768px) */
        @media (max-width: 767px) {
          .client-profile-header {
            padding: 16px;
            flex-direction: column;
            align-items: flex-start;
            gap: 16px;
          }

          .profile-identity {
            gap: 12px;
            width: 100%;
          }

          .profile-subtext {
            word-break: break-all;
            overflow-wrap: break-word;
          }

          .avatar-large {
            width: 44px;
            height: 44px;
            font-size: 1rem;
            flex-shrink: 0;
          }

          .profile-name {
            font-size: 1.25rem;
          }

          .profile-meta-details {
            width: 100%;
            justify-content: space-between;
            border-top: 1px solid var(--border-gray);
            padding-top: 12px;
            margin-top: 4px;
          }

          .meta-box {
            text-align: left;
          }

          .metrics-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .metric-card {
            padding: 12px;
          }

          .metric-val {
            font-size: 1.35rem;
          }

          .ops-table {
            display: none; /* Hide squeezed table on mobile */
          }

          .mobile-cards-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .mobile-log-card {
            background-color: var(--white);
            border: 1px solid var(--border-gray);
            border-radius: 8px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            cursor: pointer;
          }

          .mobile-log-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .mobile-log-subject {
            font-size: 0.8125rem;
            font-weight: 600;
            color: var(--text-dark);
          }

          .mobile-log-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.75rem;
            color: var(--text-muted);
            border-top: 1px dashed var(--border-gray);
            padding-top: 6px;
          }
        }
      `}</style>
    </div>
  );
}
