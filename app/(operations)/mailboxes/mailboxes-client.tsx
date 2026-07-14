"use client";

import React, { useState } from "react";
import { mockClients, MailboxStatus } from "@/lib/mockData";

export default function MailboxConnectionsPage() {
  // ── Local State ──
  const [clients, setClients] = useState(mockClients);
  const [showMapModal, setShowMapModal] = useState(false);
  const [mappingMailbox, setMappingMailbox] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [autoFilledCa, setAutoFilledCa] = useState("Unassigned");

  // Client to Advisor mapping config for mock auto-fill
  const clientToCaMap: Record<string, string> = {
    client1: "Amit Sharma",
    client2: "Amit Sharma",
    client3: "Priya Patel",
    client4: "Priya Patel",
    client5: "Rahul Verma",
    client6: "Anjali Gupta",
    client7: "Amit Sharma", // Venkat Nalabolu is mapped to Amit Sharma
  };

  // ── Metrics Calculations ──
  const totalConnected = clients.length;
  const healthyCount = clients.filter((c) => c.mailboxStatus === "Active").length;
  const needsMappingCount = clients.filter((c) => c.mailboxStatus === "Needs Mapping").length;
  const needsConnectionCount = clients.filter((c) => c.mailboxStatus === "Needs Connection").length;

  // ── Modal Actions ──
  const openMapModal = (mailbox: string) => {
    setMappingMailbox(mailbox);
    const client = clients.find((c) => c.mailbox === mailbox);
    if (client) {
      setSelectedClientId(client.id);
      handleClientChange(client.id);
    } else {
      setSelectedClientId("");
      setAutoFilledCa("Unassigned");
    }
    setShowMapModal(true);
  };

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);
    const caName = clientToCaMap[clientId] || "Unassigned";
    setAutoFilledCa(caName);
  };

  const handleSaveMapping = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId) {
      alert("Please select a client to map.");
      return;
    }

    setClients((prev) =>
      prev.map((c) => {
        if (c.id === selectedClientId) {
          return {
            ...c,
            mailboxStatus: "Active" as MailboxStatus,
            caName: autoFilledCa,
            caId: "ca1", // mock assign caId
          };
        }
        return c;
      })
    );

    setShowMapModal(false);
    alert(
      `Success! Mailbox "${mappingMailbox}" is now successfully mapped and active.\n\n` +
      `Mapped Client: ${clients.find((c) => c.id === selectedClientId)?.name}\n` +
      `Assigned Advisor: ${autoFilledCa}`
    );
  };

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
        <div className="metric-box status-blue">
          <span className="metric-lbl">Needs Mapping</span>
          <div className="metric-val text-primary">{needsMappingCount}</div>
        </div>
        <div className="metric-box status-orange">
          <span className="metric-lbl">Needs Connection</span>
          <div className="metric-val text-pending">{needsConnectionCount}</div>
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
              {clients.map((client) => {
                const statusClass = client.mailboxStatus.replace(/\s+/g, "_");
                const isNeedsMapping = client.mailboxStatus === "Needs Mapping";
                const isNeedsConnection = client.mailboxStatus === "Needs Connection";
                const isActive = client.mailboxStatus === "Active";

                return (
                  <tr key={client.id} className="table-row-hover">
                    <td>
                      <div className="client-name font-semibold">{client.name}</div>
                      <div className="client-email">{client.email}</div>
                    </td>
                    <td className="font-semibold">{client.mailbox}</td>
                    <td className="font-semibold text-muted">{client.caName}</td>
                    <td>
                      <span className={`status-pill ${statusClass}`}>
                        {client.mailboxStatus}
                      </span>
                    </td>
                    <td className="font-tabular">
                      {isActive ? "2 minutes ago" : isNeedsMapping ? "Never synced" : "18 hours ago"}
                    </td>
                    <td>
                      <div className="action-buttons-group">
                        {isNeedsMapping && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => openMapModal(client.mailbox)}
                          >
                            Map Mailbox
                          </button>
                        )}
                        {isNeedsConnection && (
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
                        {isActive && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => alert(`Refreshing Zoho sync for ${client.mailbox}...`)}
                          >
                            🔄 Refresh
                          </button>
                        )}
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            alert(
                              `Sending alert to Advisor ${client.caName} (${client.mailbox} needs attention).`
                            )
                          }
                          disabled={isNeedsMapping}
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
          {clients.map((client) => {
            const statusClass = client.mailboxStatus.replace(/\s+/g, "_");
            const isNeedsMapping = client.mailboxStatus === "Needs Mapping";
            const isNeedsConnection = client.mailboxStatus === "Needs Connection";
            const isActive = client.mailboxStatus === "Active";

            return (
              <div key={client.id} className="mobile-mailbox-card">
                <div className="card-top-row">
                  <div>
                    <div className="m-client-name">{client.name}</div>
                    <div className="m-client-mailbox">{client.mailbox}</div>
                  </div>
                  <span className={`status-pill ${statusClass}`}>
                    {client.mailboxStatus}
                  </span>
                </div>

                <div className="card-meta-details">
                  <div className="meta-row">
                    <span>Advisor:</span> <strong>{client.caName}</strong>
                  </div>
                  <div className="meta-row">
                    <span>Last Sync:</span>{" "}
                    <strong>
                      {isActive ? "2 mins ago" : isNeedsMapping ? "Never" : "18 hrs ago"}
                    </strong>
                  </div>
                </div>

                <div className="card-actions-panel">
                  {isNeedsMapping && (
                    <button
                      className="btn btn-primary btn-full"
                      onClick={() => openMapModal(client.mailbox)}
                    >
                      Map Mailbox
                    </button>
                  )}
                  {isNeedsConnection && (
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
                    disabled={isNeedsMapping}
                  >
                    ✉️ Contact CA
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Modal Dialog: Map Mailbox ── */}
      {showMapModal && (
        <div className="modal-overlay" onClick={() => setShowMapModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Map Unassigned Mailbox</h2>
              <button className="close-btn" onClick={() => setShowMapModal(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveMapping} className="modal-form">
              <div className="form-group">
                <label>Unmapped Mailbox Address</label>
                <input type="text" value={mappingMailbox} readOnly style={{ backgroundColor: "#f1f5f9" }} />
              </div>

              <div className="form-group">
                <label htmlFor="client-select">Select Existing Client Profile</label>
                <select
                  id="client-select"
                  value={selectedClientId}
                  onChange={(e) => handleClientChange(e.target.value)}
                  required
                >
                  <option value="">-- Choose Client --</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Assigned Client Advisor (Auto-filled)</label>
                <input
                  type="text"
                  value={autoFilledCa}
                  readOnly
                  style={{ backgroundColor: "#f1f5f9", fontWeight: 600 }}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowMapModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Mapping
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
          font-size: 1.625rem;
          font-weight: 700;
          color: var(--text-dark);
          letter-spacing: -0.02em;
        }

        .page-subtitle {
          color: var(--text-muted);
          font-size: 0.925rem;
          margin-top: 4px;
        }

        /* ── Metrics Row ── */
        .metrics-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
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

        .metric-box.status-blue {
          border-left: 4px solid var(--primary-blue);
        }

        .metric-box.status-orange {
          border-left: 4px solid var(--pending-orange);
        }

        .metric-lbl {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .metric-val {
          font-size: 1.65rem;
          font-weight: 700;
        }

        .text-success { color: var(--success-green); }
        .text-primary { color: var(--primary-blue); }
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
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
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

        .client-name {
          font-size: 0.875rem;
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
          white-space: nowrap;
        }

        .status-pill.Active {
          background-color: var(--success-green-bg);
          color: var(--success-green);
        }

        .status-pill.Needs_Mapping {
          background-color: rgba(37, 99, 235, 0.1);
          color: var(--primary-blue);
        }

        .status-pill.Needs_Connection {
          background-color: var(--pending-orange-bg);
          color: var(--pending-orange);
        }

        .status-pill.Needs_Attention {
          background-color: var(--urgent-red-bg);
          color: var(--urgent-red);
        }

        .status-pill.Disabled {
          background-color: var(--border-gray);
          color: var(--text-muted);
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
          font-size: 0.8125rem;
          padding: 8px 16px;
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

        /* ── Modal Dialog Styles ── */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background-color: rgba(0, 0, 0, 0.4);
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(4px);
        }

        .modal-card {
          background-color: var(--white);
          border-radius: 16px;
          width: 100%;
          max-width: 480px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          overflow: hidden;
          animation: scaleUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes scaleUp {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }

        .modal-header {
          padding: 20px 24px;
          border-bottom: 1px solid var(--border-gray);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .modal-header h2 {
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--text-dark);
        }

        .close-btn {
          background: none;
          border: none;
          font-size: 1.25rem;
          color: var(--text-muted);
          cursor: pointer;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .modal-form {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-group label {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-muted);
        }

        .form-group input,
        .form-group select {
          padding: 10px 14px;
          font-family: inherit;
          font-size: 0.875rem;
          border: 1px solid var(--border-gray);
          border-radius: 8px;
          outline: none;
          color: var(--text-dark);
        }

        .form-group input:focus,
        .form-group select:focus {
          border-color: var(--primary-blue);
        }

        .modal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          border-top: 1px solid var(--border-gray);
          padding-top: 16px;
          margin-top: 8px;
        }

        /* ── Responsive Rules ── */
        @media (max-width: 1023px) {
          .ops-table th:nth-child(3),
          .ops-table td:nth-child(3),
          .ops-table th:nth-child(5),
          .ops-table td:nth-child(5) {
            display: none; /* Hide CA & Last Sync on tablet */
          }
          .metrics-row {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        @media (max-width: 767px) {
          .metrics-row {
            grid-template-columns: 1fr;
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
            gap: 12px;
          }

          .card-top-row > div:first-child {
            min-width: 0;
            flex: 1;
          }

          .m-client-name {
            font-weight: 700;
            font-size: 0.875rem;
          }

          .m-client-mailbox {
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-top: 2px;
            word-break: break-all;
            overflow-wrap: break-word;
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
