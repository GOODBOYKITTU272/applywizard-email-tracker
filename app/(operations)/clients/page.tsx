"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { mockClients, mockCAs } from "@/lib/mockData";

export default function ClientsPage() {
  const router = useRouter();

  // ── States ──────────────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientMailbox, setNewClientMailbox] = useState("");
  const [selectedCA, setSelectedCA] = useState(mockCAs[0]?.id || "");

  // ── Filter Clients ──────────────────────────────────────────────────────────
  const filteredClients = useMemo(() => {
    return mockClients.filter((client) => {
      return (
        searchTerm === "" ||
        client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.mailbox.toLowerCase().includes(searchTerm.toLowerCase()) ||
        client.caName.toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
  }, [searchTerm]);

  // ── Submit Add Client Handler ───────────────────────────────────────────────
  const handleAddClientSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName || !newClientEmail || !newClientMailbox) {
      alert("Please fill in all fields.");
      return;
    }
    
    // Simulate successful addition
    alert(
      `Success! Mock client "${newClientName}" registered successfully.\n` +
      `Mailbox: ${newClientMailbox}\n` +
      `Assigned Advisor: ${mockCAs.find((ca) => ca.id === selectedCA)?.name}`
    );
    
    // Reset state & close
    setNewClientName("");
    setNewClientEmail("");
    setNewClientMailbox("");
    setShowAddModal(false);
  };

  return (
    <div className="clients-page-container">
      {/* Header bar */}
      <header className="page-header">
        <div>
          <h1 className="page-title">Clients & Mailboxes</h1>
          <p className="page-subtitle">
            Configure applicant client profiles, connect mailboxes, and track advisor assignments.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          ➕ Add Client Mailbox
        </button>
      </header>

      {/* Search control */}
      <section className="search-card">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          placeholder="Search by client name, email, Zoho mailbox, assigned CA..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </section>

      {/* Clients Data Results */}
      <section className="clients-list-container">
        {filteredClients.length === 0 ? (
          <div className="empty-results-box">
            <span className="empty-icon">👥</span>
            <h3>No Clients Found</h3>
            <p>No client records match your current search queries.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table view */}
            <div className="table-card">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Client Name / Email</th>
                    <th>Zoho Mailbox</th>
                    <th>Mailbox Status</th>
                    <th>Assigned CA</th>
                    <th>Emails Today</th>
                    <th>Pending Class.</th>
                    <th>Review Req.</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((client) => (
                    <tr key={client.id} className="table-row-hover">
                      <td>
                        <div className="client-name font-semibold">{client.name}</div>
                        <div className="client-email">{client.email}</div>
                      </td>
                      <td className="font-semibold">{client.mailbox}</td>
                      <td>
                        <span className={`status-pill ${client.mailboxStatus}`}>
                          {client.mailboxStatus === "healthy" ? "Active" : "Needs Reconnect"}
                        </span>
                      </td>
                      <td>{client.caName}</td>
                      <td className="font-tabular">{client.emailsToday}</td>
                      <td className="font-tabular">{client.pendingClassification}</td>
                      <td className="font-tabular font-bold text-urgent">
                        {client.reviewRequired}
                      </td>
                      <td>
                        <button
                          className="action-btn"
                          onClick={() => router.push(`/clients/${client.id}`)}
                        >
                          Open Dashboard
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards view */}
            <div className="mobile-cards-list">
              {filteredClients.map((client) => (
                <div key={client.id} className="mobile-client-card">
                  <div className="card-top-row">
                    <div>
                      <div className="m-client-name">{client.name}</div>
                      <div className="m-client-email">{client.email}</div>
                    </div>
                    <span className={`status-pill ${client.mailboxStatus}`}>
                      {client.mailboxStatus === "healthy" ? "Active" : "Error"}
                    </span>
                  </div>

                  <div className="card-mid-details">
                    <div className="m-detail-row">
                      <span>Mailbox:</span>
                      <strong>{client.mailbox}</strong>
                    </div>
                    <div className="m-detail-row">
                      <span>Advisor:</span>
                      <strong>{client.caName}</strong>
                    </div>
                  </div>

                  <div className="card-bottom-counts">
                    <div className="count-badge">
                      <span>Today:</span> <strong>{client.emailsToday}</strong>
                    </div>
                    <div className="count-badge">
                      <span>Pending:</span> <strong>{client.pendingClassification}</strong>
                    </div>
                    <div className="count-badge urgent-badge">
                      <span>Review:</span> <strong>{client.reviewRequired}</strong>
                    </div>
                  </div>

                  <div className="card-actions-panel">
                    <button
                      className="btn btn-secondary btn-full"
                      onClick={() => router.push(`/clients/${client.id}`)}
                    >
                      Open Client Dashboard
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── Mock Add Client Modal ── */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Client Mailbox Connection</h2>
              <button className="close-btn" onClick={() => setShowAddModal(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleAddClientSubmit} className="modal-form">
              <div className="form-group">
                <label htmlFor="name-input">Client Name</label>
                <input
                  id="name-input"
                  type="text"
                  placeholder="e.g. Rohan Mehta"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="email-input">Client Personal Email</label>
                <input
                  id="email-input"
                  type="email"
                  placeholder="e.g. rohan@gmail.com"
                  value={newClientEmail}
                  onChange={(e) => setNewClientEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="mailbox-input">Zoho Mailbox Email</label>
                <input
                  id="mailbox-input"
                  type="email"
                  placeholder="e.g. rohan.m@zohomail.in"
                  value={newClientMailbox}
                  onChange={(e) => setNewClientMailbox(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="ca-select-form">Assigned Client Advisor</label>
                <select
                  id="ca-select-form"
                  value={selectedCA}
                  onChange={(e) => setSelectedCA(e.target.value)}
                >
                  {mockCAs.map((ca) => (
                    <option key={ca.id} value={ca.id}>
                      {ca.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Register Mailbox
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .clients-page-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .page-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
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

        /* ── Search Bar ── */
        .search-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 16px 24px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: var(--card-shadow);
        }

        .search-icon {
          font-size: 1.15rem;
          color: var(--text-light);
        }

        .search-card input {
          border: none;
          background: none;
          outline: none;
          width: 100%;
          color: var(--text-dark);
          font-size: 0.925rem;
          font-family: var(--font-display);
        }

        /* ── Results List ── */
        .clients-list-container {
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

        .font-bold {
          font-weight: 700;
        }

        .font-tabular {
          font-feature-settings: "tnum";
        }

        .text-urgent {
          color: var(--urgent-red);
        }

        /* Badges & Pills */
        .status-pill {
          display: inline-flex;
          padding: 2px 8px;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .status-pill.healthy {
          background-color: var(--success-green-bg);
          color: var(--success-green);
        }

        .status-pill.needs_reconnect {
          background-color: var(--pending-orange-bg);
          color: var(--pending-orange);
        }

        .action-btn {
          background: none;
          border: none;
          color: var(--primary-blue);
          font-weight: 600;
          cursor: pointer;
          font-size: 0.875rem;
        }

        .action-btn:hover {
          text-decoration: underline;
        }

        /* Reusable button styling */
        .btn {
          padding: 10px 20px;
          font-size: 0.875rem;
          font-weight: 600;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          transition: background-color 0.2s;
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

        .btn-full {
          width: 100%;
          display: flex;
          justify-content: center;
        }

        /* Reusable empty results */
        .empty-results-box {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 48px;
          text-align: center;
          box-shadow: var(--card-shadow);
        }

        .empty-icon {
          font-size: 3rem;
          display: block;
          margin-bottom: 12px;
        }

        .empty-results-box h3 {
          font-size: 1.25rem;
          font-weight: 700;
        }

        .empty-results-box p {
          color: var(--text-muted);
          font-size: 0.925rem;
          margin-top: 8px;
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
          box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
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
          border: 1px solid var(--border-gray);
          border-radius: 8px;
          background-color: var(--white);
          color: var(--text-dark);
          font-size: 0.875rem;
          outline: none;
          font-family: var(--font-display);
        }

        .form-group input:focus {
          border-color: var(--primary-blue);
        }

        .form-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 12px;
          border-top: 1px solid var(--border-gray);
          padding-top: 16px;
        }

        .mobile-cards-list {
          display: none;
        }

        /* ── Responsive Rules ── */
        @media (max-width: 1023px) {
          .ops-table th:nth-child(5),
          .ops-table td:nth-child(5),
          .ops-table th:nth-child(6),
          .ops-table td:nth-child(6) {
            display: none; /* Hide secondary counts on tablet */
          }
        }

        @media (max-width: 767px) {
          .page-header {
            flex-direction: column;
            align-items: flex-start;
          }

          .page-header .btn {
            width: 100%;
            display: flex;
            justify-content: center;
          }

          .table-card {
            display: none;
          }

          .mobile-cards-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .mobile-client-card {
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

          .m-client-email {
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-top: 2px;
          }

          .card-mid-details {
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-size: 0.8125rem;
          }

          .m-detail-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .m-detail-row span {
            color: var(--text-muted);
          }

          .card-bottom-counts {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            border-top: 1px dashed var(--border-gray);
            padding-top: 10px;
          }

          .count-badge {
            font-size: 0.75rem;
            color: var(--text-muted);
            background-color: var(--workspace-bg);
            padding: 4px 8px;
            border-radius: 6px;
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .count-badge.urgent-badge {
            background-color: var(--urgent-red-bg);
            color: var(--urgent-red);
          }

          .card-actions-panel {
            margin-top: 4px;
          }
        }
      `}</style>
    </div>
  );
}
