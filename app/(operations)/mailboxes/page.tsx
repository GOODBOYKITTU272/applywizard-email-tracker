"use client";

import React from "react";
import { mockClients } from "@/lib/mockData";

export default function MailboxConnectionsPage() {
  // Calculations
  const totalConnected = mockClients.length;
  const healthyCount = mockClients.filter((c) => c.mailboxStatus === "healthy").length;
  const issueCount = mockClients.filter((c) => c.mailboxStatus === "needs_reconnect").length;

  return (
    <div className="mailboxes-page-container">
      {/* Page Header */}
      <header className="page-header">
        <div>
          <h1 className="page-title">Mailbox Connections</h1>
          <p className="page-subtitle">
            Monitor API sync statuses, Zoho OAuth health records, and connection lifetimes.
          </p>
        </div>
      </header>

      {/* Metrics Row */}
      <section className="metrics-row">
        <div className="metric-box">
          <span className="metric-lbl">Connected Mailboxes</span>
          <div className="metric-val">{totalConnected}</div>
        </div>
        <div className="metric-box status-green">
          <span className="metric-lbl">Syncing Healthy</span>
          <div className="metric-val text-success">{healthyCount}</div>
        </div>
        <div className="metric-box status-orange">
          <span className="metric-lbl">Needs Reconnection</span>
          <div className="metric-val text-pending">{issueCount}</div>
        </div>
      </section>

      {/* Mailbox connections log list */}
      <section className="table-card-container">
        <div className="table-card">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Zoho Mailbox Address</th>
                <th>Assigned CA</th>
                <th>Connection Status</th>
                <th>Last Synced</th>
                <th>Operational Actions</th>
              </tr>
            </thead>
            <tbody>
              {mockClients.map((client) => {
                const isHealthy = client.mailboxStatus === "healthy";
                return (
                  <tr key={client.id} className="table-row-hover">
                    <td>
                      <div className="client-name font-semibold">{client.name}</div>
                      <div className="client-email">{client.email}</div>
                    </td>
                    <td className="font-semibold">{client.mailbox}</td>
                    <td>{client.caName}</td>
                    <td>
                      <span className={`status-pill ${client.mailboxStatus}`}>
                        {isHealthy ? "✓ Healthy" : "⚠️ Reconnect Required"}
                      </span>
                    </td>
                    <td className="font-tabular">
                      {isHealthy ? "2 minutes ago" : "18 hours ago"}
                    </td>
                    <td>
                      <div className="action-buttons-group">
                        {!isHealthy && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() =>
                              alert(
                                `Initiating Zoho OAuth reconnect workflow for ${client.mailbox}...`
                              )
                            }
                          >
                            🔄 Reconnect Zoho
                          </button>
                        )}
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            alert(
                              `Sending alert to Advisor ${client.caName} (${client.mailbox} needs attention).`
                            )
                          }
                        >
                          ✉️ Contact CA
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className="mobile-cards-list">
          {mockClients.map((client) => {
            const isHealthy = client.mailboxStatus === "healthy";
            return (
              <div key={client.id} className="mobile-mailbox-card">
                <div className="card-top-row">
                  <div>
                    <div className="m-client-name">{client.name}</div>
                    <div className="m-client-mailbox">{client.mailbox}</div>
                  </div>
                  <span className={`status-pill ${client.mailboxStatus}`}>
                    {isHealthy ? "Active" : "Error"}
                  </span>
                </div>

                <div className="card-meta-details">
                  <div className="meta-row">
                    <span>Advisor:</span> <strong>{client.caName}</strong>
                  </div>
                  <div className="meta-row">
                    <span>Last Sync:</span>{" "}
                    <strong>{isHealthy ? "2 mins ago" : "18 hrs ago"}</strong>
                  </div>
                </div>

                <div className="card-actions-panel">
                  {!isHealthy && (
                    <button
                      className="btn btn-primary btn-full"
                      onClick={() =>
                        alert(`Initiating Zoho OAuth reconnect workflow for ${client.mailbox}...`)
                      }
                    >
                      🔄 Reconnect Zoho
                    </button>
                  )}
                  <button
                    className="btn btn-secondary btn-full"
                    onClick={() =>
                      alert(
                        `Sending alert to Advisor ${client.caName} (${client.mailbox} needs attention).`
                      )
                    }
                  >
                    ✉️ Contact CA
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <style jsx>{`
        .mailboxes-page-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .page-header {
          margin-bottom: 8px;
        }

        .page-title {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 1.85rem;
          font-weight: 700;
          color: var(--text-dark);
        }

        .page-subtitle {
          color: var(--text-muted);
          font-size: 0.95rem;
          margin-top: 4px;
        }

        /* ── Metrics Row ── */
        .metrics-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }

        .metric-box {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-shadow: var(--card-shadow);
        }

        .metric-box.status-green {
          border-left: 4px solid var(--success-green);
        }

        .metric-box.status-orange {
          border-left: 4px solid var(--pending-orange);
        }

        .metric-lbl {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-muted);
        }

        .metric-val {
          font-size: 1.85rem;
          font-weight: 700;
        }

        .text-success { color: var(--success-green); }
        .text-pending { color: var(--pending-orange); }
        .font-tabular { font-feature-settings: "tnum"; }

        /* ── Connection Table ── */
        .table-card-container {
          width: 100%;
        }

        .table-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          box-shadow: var(--card-shadow);
          overflow: hidden;
        }

        .ops-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.875rem;
        }

        .ops-table th {
          padding: 14px 20px;
          color: var(--text-muted);
          font-weight: 600;
          border-bottom: 1px solid var(--border-gray);
          background-color: rgba(248, 250, 252, 0.5);
        }

        .ops-table td {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-gray);
          vertical-align: middle;
        }

        .table-row-hover:hover {
          background-color: var(--workspace-bg);
        }

        .client-email {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .font-semibold {
          font-weight: 600;
        }

        /* Status Pills */
        .status-pill {
          display: inline-flex;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .status-pill.healthy {
          background-color: var(--success-green-bg);
          color: var(--success-green);
        }

        .status-pill.needs_reconnect {
          background-color: var(--urgent-red-bg);
          color: var(--urgent-red);
        }

        .action-buttons-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        /* Reusable buttons */
        .btn {
          font-weight: 600;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          transition: background-color 0.2s;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .btn-primary {
          background-color: var(--primary-blue);
          color: var(--white);
        }

        .btn-primary:hover {
          background-color: var(--primary-blue-hover);
        }

        .btn-secondary {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          color: var(--text-dark);
        }

        .btn-secondary:hover {
          background-color: var(--workspace-bg);
        }

        .btn-sm {
          padding: 6px 12px;
          font-size: 0.75rem;
        }

        .btn-full {
          width: 100%;
          display: flex;
          justify-content: center;
        }

        .mobile-cards-list {
          display: none;
        }

        /* ── Responsive Rules ── */
        @media (max-width: 1023px) {
          .ops-table th:nth-child(3),
          .ops-table td:nth-child(3),
          .ops-table th:nth-child(5),
          .ops-table td:nth-child(5) {
            display: none; /* Hide assigned CA & last sync on tablet to prevent wrapping */
          }
        }

        @media (max-width: 767px) {
          .metrics-row {
            grid-template-columns: 1fr; /* Stack boxes */
          }

          .table-card {
            display: none;
          }

          .mobile-cards-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .mobile-mailbox-card {
            background-color: var(--white);
            border: 1px solid var(--border-gray);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-shadow: var(--card-shadow);
          }

          .card-top-row {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
          }

          .m-client-name {
            font-weight: 700;
            font-size: 0.875rem;
          }

          .m-client-mailbox {
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-top: 2px;
          }

          .card-meta-details {
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-size: 0.8125rem;
          }

          .meta-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .meta-row span {
            color: var(--text-muted);
          }

          .card-actions-panel {
            display: flex;
            flex-direction: column;
            gap: 8px;
            border-top: 1px dashed var(--border-gray);
            padding-top: 12px;
            margin-top: 4px;
          }
        }
      `}</style>
    </div>
  );
}
