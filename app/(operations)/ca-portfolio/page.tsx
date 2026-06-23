"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { mockClients, mockCAs } from "@/lib/mockData";

export default function CAPortfolioPage() {
  const router = useRouter();

  // ── States ──────────────────────────────────────────────────────────────────
  const [activeCaId, setActiveCaId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("name");
  
  // Modals
  const [showAddAdvisorModal, setShowAddAdvisorModal] = useState(false);
  const [showAssignClientModal, setShowAssignClientModal] = useState(false);

  // New Advisor Form State
  const [newCaName, setNewCaName] = useState("");
  const [newCaEmail, setNewCaEmail] = useState("");

  // Assign Client Form State
  const [assignClientId, setAssignClientId] = useState("");
  const [assignCaId, setAssignCaId] = useState("");

  // Helper to generate name initials for avatar
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  // Helper to assign a specific avatar background color based on name length
  const getAvatarColor = (name: string) => {
    const colors = ["#2563eb", "#7c3aed", "#0891b2", "#0d9488", "#ea580c", "#db2777"];
    const index = name.length % colors.length;
    return colors[index];
  };

  // ── Computed Portfolio Data ──────────────────────────────────────────────────
  const globalStats = useMemo(() => {
    const clientsCount = mockClients.length;
    const healthyMailboxesCount = mockClients.filter((c) => c.mailboxStatus === "Active").length;
    const needsReconnectCount = mockClients.filter((c) => c.mailboxStatus !== "Active" && c.mailboxStatus !== "Needs Mapping").length;
    const pendingReviewsCount = mockClients.filter((c) => c.reviewRequired > 0).length;
    const totalReviewsNeeded = mockClients.reduce((sum, c) => sum + c.reviewRequired, 0);

    return {
      clientsCount,
      healthyMailboxesCount,
      needsReconnectCount,
      pendingReviewsCount,
      totalReviewsNeeded,
    };
  }, []);

  // Filtered & Sorted CA Advisor cards
  const filteredCAs = useMemo(() => {
    let result = [...mockCAs];

    // Search query
    if (searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (ca) =>
          ca.name.toLowerCase().includes(q) ||
          ca.email.toLowerCase().includes(q)
      );
    }

    // Sort options
    result.sort((a, b) => {
      if (sortBy === "name") {
        return a.name.localeCompare(b.name);
      } else if (sortBy === "workload") {
        return b.totalClients - a.totalClients;
      } else if (sortBy === "review") {
        return b.reviewRequired - a.reviewRequired;
      }
      return 0;
    });

    return result;
  }, [searchQuery, sortBy]);

  // Clients displayed in the details table
  const displayedClients = useMemo(() => {
    let list = mockClients;
    if (activeCaId !== "all") {
      list = mockClients.filter((c) => c.caId === activeCaId);
    }
    return list;
  }, [activeCaId]);

  // Find active CA object for dashboard context details
  const activeCA = useMemo(() => {
    return mockCAs.find((ca) => ca.id === activeCaId);
  }, [activeCaId]);

  // ── Form Submissions ──────────────────────────────────────────────────────────
  const handleAddAdvisorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCaName || !newCaEmail) {
      alert("Please fill in all fields.");
      return;
    }
    
    // Simulate successful advisor creation
    alert(
      `Success! New Client Advisor registered.\n\n` +
      `Name: ${newCaName}\n` +
      `Email: ${newCaEmail}\n` +
      `Status: Active (0 clients assigned)`
    );

    setNewCaName("");
    setNewCaEmail("");
    setShowAddAdvisorModal(false);
  };

  const handleAssignClientSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignClientId || !assignCaId) {
      alert("Please select both a client and an advisor.");
      return;
    }

    const client = mockClients.find((c) => c.id === assignClientId);
    const ca = mockCAs.find((c) => c.id === assignCaId);

    // Simulate successful reassignment
    alert(
      `Success! Workload assignment updated.\n\n` +
      `Client: ${client?.name}\n` +
      `Assigned Advisor: ${ca?.name}`
    );

    setAssignClientId("");
    setAssignCaId("");
    setShowAssignClientModal(false);
  };

  return (
    <div className="ca-portfolio-container">
      {/* ── Page Header ── */}
      <header className="page-header">
        <div>
          <h1 className="page-title">Client Advisor (CA) Portfolio</h1>
          <p className="page-subtitle">
            Manage advisor workloads, assign clients, and monitor operation queues across your CA team.
          </p>
        </div>
        {/* Reassign Client and Add Advisor buttons are hidden in current phase */}
      </header>

      {/* ── Operations Summary Cards ── */}
      <section className="summary-ribbon">
        <div className="summary-card">
          <span className="summary-card-icon">👥</span>
          <div className="summary-card-content">
            <span className="summary-label">Total Assigned Clients</span>
            <span className="summary-value">{globalStats.clientsCount}</span>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-card-icon text-success">🔌</span>
          <div className="summary-card-content">
            <span className="summary-label">Active Zoho Feeds</span>
            <span className="summary-value">
              {globalStats.healthyMailboxesCount} / {globalStats.clientsCount}
            </span>
          </div>
        </div>
        <div className="summary-card">
          <span className="summary-card-icon text-urgent">⚠️</span>
          <div className="summary-card-content">
            <span className="summary-label">Total Pending Reviews</span>
            <span className="summary-value text-urgent">{globalStats.totalReviewsNeeded}</span>
          </div>
        </div>
      </section>

      {/* ── Filter & Search Control Panel ── */}
      <section className="control-panel">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search Advisors by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="sort-group">
          <label htmlFor="sort-select">Sort by:</label>
          <select
            id="sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="sort-select"
          >
            <option value="name">Name (A-Z)</option>
            <option value="workload">Workload (Most Clients)</option>
            <option value="review">Queue Size (Reviews Needed)</option>
          </select>
        </div>
      </section>

      {/* ── Advisor Cards Grid ── */}
      <section className="advisor-grid">
        {/* 'All Advisors' selector card */}
        <div
          className={`advisor-card all-selector-card ${activeCaId === "all" ? "active" : ""}`}
          onClick={() => setActiveCaId("all")}
        >
          <div className="card-selection-indicator" />
          <div className="advisor-info-header">
            <div className="advisor-avatar" style={{ backgroundColor: "#0f172a" }}>
              🌐
            </div>
            <div>
              <h3 className="advisor-name">All Client Advisors</h3>
              <p className="advisor-email">Entire operations pipeline</p>
            </div>
          </div>
          <div className="card-stats-layout">
            <div className="stat-pill">
              <span className="stat-label">Clients</span>
              <span className="stat-number">{globalStats.clientsCount}</span>
            </div>
            <div className="stat-pill">
              <span className="stat-label">Mailboxes</span>
              <span className="stat-number">
                {globalStats.healthyMailboxesCount} active
              </span>
            </div>
            <div className="stat-pill highlight-pill">
              <span className="stat-label">Reviews</span>
              <span className="stat-number">{globalStats.totalReviewsNeeded}</span>
            </div>
          </div>
        </div>

        {filteredCAs.map((ca) => {
          const isSelected = activeCaId === ca.id;
          const assigned = mockClients.filter((c) => c.caId === ca.id);
          const needsReconnect = assigned.some((c) => c.mailboxStatus !== "Active" && c.mailboxStatus !== "Needs Mapping");

          return (
            <div
              key={ca.id}
              className={`advisor-card ${isSelected ? "active" : ""}`}
              onClick={() => setActiveCaId(ca.id)}
            >
              <div className="card-selection-indicator" />
              <div className="advisor-info-header">
                <div
                  className="advisor-avatar"
                  style={{ backgroundColor: getAvatarColor(ca.name) }}
                >
                  {getInitials(ca.name)}
                </div>
                <div>
                  <h3 className="advisor-name">{ca.name}</h3>
                  <p className="advisor-email">{ca.email}</p>
                </div>
              </div>

              <div className="card-stats-layout">
                <div className="stat-pill">
                  <span className="stat-label">Clients</span>
                  <span className="stat-number">{ca.totalClients}</span>
                </div>
                <div className="stat-pill">
                  <span className="stat-label">Mailboxes</span>
                  <span className="stat-number">
                    {ca.connectedMailboxes} / {ca.totalClients}
                  </span>
                </div>
                <div className={`stat-pill ${ca.reviewRequired > 0 ? "urgent-pill" : ""}`}>
                  <span className="stat-label">Reviews</span>
                  <span className="stat-number">{ca.reviewRequired}</span>
                </div>
              </div>

              {/* Sub-stat breakdown */}
              <div className="sub-stat-breakdown">
                <div className="sub-stat-item">
                  <span className="sub-label">Apps</span>
                  <span className="sub-val">{ca.applications}</span>
                </div>
                <div className="sub-stat-item">
                  <span className="sub-label">Int. Invites</span>
                  <span className="sub-val text-success">{ca.interviews}</span>
                </div>
                <div className="sub-stat-item">
                  <span className="sub-label">Assess.</span>
                  <span className="sub-val text-pending">{ca.assessments}</span>
                </div>
                <div className="sub-stat-item">
                  <span className="sub-label">Rejections</span>
                  <span className="sub-val text-muted">{ca.rejections}</span>
                </div>
              </div>

              {needsReconnect && (
                <div className="card-alert-banner">
                  <span className="alert-dot" />
                  <span>Mailbox Connection Error Present</span>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* ── Client Portfolio List ── */}
      <section className="client-list-section">
        <div className="section-header">
          <h2>
            {activeCaId === "all"
              ? "All Assigned Clients"
              : `Clients Assigned to ${activeCA?.name}`}
          </h2>
          <span className="count-badge">{displayedClients.length} clients</span>
        </div>

        {displayedClients.length === 0 ? (
          <div className="empty-results">
            <span className="empty-icon">👥</span>
            <h3>No clients assigned</h3>
            <p>This advisor currently has no active client mailboxes linked to them.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="table-card">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Client Name / Email</th>
                    <th>Zoho Mailbox</th>
                    <th>Mailbox Status</th>
                    <th>Review Queue</th>
                    <th>Sync Volume</th>
                    <th>Assigned Advisor</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedClients.map((client) => (
                    <tr key={client.id} className="table-row-hover">
                      <td>
                        <div className="client-name font-semibold">{client.name}</div>
                        <div className="client-email">{client.email}</div>
                      </td>
                      <td className="font-semibold">{client.mailbox}</td>
                      <td>
                        <span className={`status-pill ${client.mailboxStatus === "Active" ? "healthy" : "needs_reconnect"}`}>
                          {client.mailboxStatus}
                        </span>
                      </td>
                      <td>
                        {client.reviewRequired > 0 ? (
                          <span className="badge badge-urgent font-bold">
                            ⚠️ {client.reviewRequired} action required
                          </span>
                        ) : (
                          <span className="badge badge-clean">✓ Up to date</span>
                        )}
                      </td>
                      <td>
                        <div className="sync-stats">
                          <span className="font-tabular font-semibold">{client.emailsToday}</span>
                          <span className="sync-lbl">today</span>
                        </div>
                      </td>
                      <td className="font-semibold text-muted">{client.caName}</td>
                      <td>
                        <button
                          className="action-btn"
                          onClick={() => router.push(`/clients/${client.id}`)}
                        >
                          View Dashboard
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards Stack View */}
            <div className="mobile-cards-list">
              {displayedClients.map((client) => (
                <div key={client.id} className="mobile-client-card">
                  <div className="card-top-row">
                    <div>
                      <div className="m-client-name">{client.name}</div>
                      <div className="m-client-email">{client.email}</div>
                    </div>
                    <span className={`status-pill ${client.mailboxStatus === "Active" ? "healthy" : "needs_reconnect"}`}>
                      {client.mailboxStatus}
                    </span>
                  </div>

                  <div className="m-card-body-row">
                    <div>
                      <span className="m-body-lbl">Mailbox:</span>
                      <div className="m-body-val font-semibold">{client.mailbox}</div>
                    </div>
                    <div>
                      <span className="m-body-lbl">Advisor:</span>
                      <div className="m-body-val font-semibold">{client.caName}</div>
                    </div>
                  </div>

                  <div className="m-card-footer">
                    <div className="m-stats">
                      <span>Sync: <strong>{client.emailsToday} today</strong></span>
                      <span>Pending: <strong>{client.pendingClassification}</strong></span>
                    </div>

                    {client.reviewRequired > 0 ? (
                      <span className="badge badge-urgent">
                        ⚠️ {client.reviewRequired} Action
                      </span>
                    ) : (
                      <span className="badge badge-clean">✓ Clear</span>
                    )}
                  </div>

                  <button
                    className="btn btn-secondary btn-full"
                    style={{ marginTop: "12px" }}
                    onClick={() => router.push(`/clients/${client.id}`)}
                  >
                    Open Client Dashboard
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── Modal: Add Advisor ── */}
      {showAddAdvisorModal && (
        <div className="modal-overlay" onClick={() => setShowAddAdvisorModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add Client Advisor (CA) <span style={{fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', backgroundColor: '#e2e8f0', color: '#64748b', marginLeft: '8px'}}>Mock Only</span></h2>
              <button className="close-btn" onClick={() => setShowAddAdvisorModal(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleAddAdvisorSubmit} className="modal-form">
              <div className="form-group">
                <label htmlFor="advisor-name">Advisor Full Name</label>
                <input
                  type="text"
                  id="advisor-name"
                  placeholder="e.g. Amit Sharma"
                  value={newCaName}
                  onChange={(e) => setNewCaName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="advisor-email">ApplyWizard Staff Email</label>
                <input
                  type="email"
                  id="advisor-email"
                  placeholder="e.g. amit@applywizard.ai"
                  value={newCaEmail}
                  onChange={(e) => setNewCaEmail(e.target.value)}
                  required
                />
              </div>

              <div className="modal-actions" style={{ marginTop: "8px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddAdvisorModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Register Advisor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Reassign Client ── */}
      {showAssignClientModal && (
        <div className="modal-overlay" onClick={() => setShowAssignClientModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Reassign Client Advisor <span style={{fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', backgroundColor: '#e2e8f0', color: '#64748b', marginLeft: '8px'}}>Mock Only</span></h2>
              <button className="close-btn" onClick={() => setShowAssignClientModal(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleAssignClientSubmit} className="modal-form">
              <div className="form-group">
                <label htmlFor="client-select">Select Client Profile</label>
                <select
                  id="client-select"
                  value={assignClientId}
                  onChange={(e) => setAssignClientId(e.target.value)}
                  required
                >
                  <option value="">-- Choose Client --</option>
                  {mockClients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} ({client.mailbox})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="target-ca-select">Assign to Client Advisor</label>
                <select
                  id="target-ca-select"
                  value={assignCaId}
                  onChange={(e) => setAssignCaId(e.target.value)}
                  required
                >
                  <option value="">-- Choose Advisor --</option>
                  {mockCAs.map((ca) => (
                    <option key={ca.id} value={ca.id}>
                      {ca.name} ({ca.totalClients} current clients)
                    </option>
                  ))}
                </select>
              </div>

              <div className="modal-actions" style={{ marginTop: "8px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAssignClientModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Assignment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Styled JSX Stylesheets ── */}
      <style jsx>{`
        .ca-portfolio-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* ── Page Header ── */
        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
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

        .header-button-group {
          display: flex;
          gap: 12px;
          flex-shrink: 0;
        }

        /* ── Summary Ribbon ── */
        .summary-ribbon {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }

        .summary-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 16px 20px;
          display: flex;
          align-items: center;
          gap: 16px;
          box-shadow: var(--card-shadow);
        }

        .summary-card-icon {
          font-size: 1.75rem;
          width: 48px;
          height: 48px;
          border-radius: 10px;
          background-color: var(--workspace-bg);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .summary-card-content {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .summary-label {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .summary-value {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text-dark);
        }

        /* ── Control Panel ── */
        .control-panel {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 16px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }

        .search-box {
          position: relative;
          flex: 1;
          max-width: 400px;
        }

        .search-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 0.875rem;
          color: var(--text-light);
        }

        .search-box input {
          width: 100%;
          padding: 10px 14px 10px 38px;
          font-family: inherit;
          font-size: 0.875rem;
          border: 1px solid var(--border-gray);
          border-radius: 8px;
          outline: none;
          color: var(--text-dark);
          transition: border-color 0.2s;
        }

        .search-box input:focus {
          border-color: var(--primary-blue);
        }

        .sort-group {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .sort-group label {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-muted);
        }

        .sort-select {
          padding: 8px 12px;
          font-family: inherit;
          font-size: 0.875rem;
          border: 1px solid var(--border-gray);
          border-radius: 8px;
          background-color: var(--white);
          outline: none;
          color: var(--text-dark);
          cursor: pointer;
        }

        /* ── Advisor Cards Grid ── */
        .advisor-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
        }

        .advisor-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 20px;
          position: relative;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-shadow: var(--card-shadow);
          transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
        }

        .advisor-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--card-shadow-hover);
        }

        .advisor-card.active {
          border-color: var(--primary-blue);
          box-shadow: 0 0 0 1px var(--primary-blue), var(--card-shadow-hover);
        }

        .card-selection-indicator {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 4px;
          border-top-left-radius: 12px;
          border-top-right-radius: 12px;
          background-color: transparent;
        }

        .advisor-card.active .card-selection-indicator {
          background-color: var(--primary-blue);
        }

        .advisor-info-header {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .advisor-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          color: var(--white);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 0.95rem;
          flex-shrink: 0;
        }

        .advisor-name {
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--text-dark);
        }

        .advisor-email {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-top: 1px;
        }

        .card-stats-layout {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          border-top: 1px solid var(--border-gray);
          border-bottom: 1px solid var(--border-gray);
          padding: 12px 0;
        }

        .stat-pill {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          background-color: var(--workspace-bg);
          border-radius: 6px;
          padding: 6px 4px;
        }

        .stat-label {
          font-size: 0.625rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .stat-number {
          font-size: 0.875rem;
          font-weight: 700;
          color: var(--text-dark);
        }

        .stat-pill.urgent-pill {
          background-color: var(--urgent-red-bg);
        }

        .stat-pill.urgent-pill .stat-number {
          color: var(--urgent-red);
        }

        .stat-pill.highlight-pill {
          background-color: var(--pending-orange-bg);
        }

        .stat-pill.highlight-pill .stat-number {
          color: var(--pending-orange);
        }

        /* Sub-stat breakdowns */
        .sub-stat-breakdown {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 4px;
        }

        .sub-stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .sub-label {
          font-size: 0.625rem;
          color: var(--text-muted);
          text-align: center;
        }

        .sub-val {
          font-size: 0.75rem;
          font-weight: 600;
        }

        .card-alert-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.75rem;
          color: var(--pending-orange);
          background-color: var(--pending-orange-bg);
          padding: 6px 12px;
          border-radius: 6px;
          font-weight: 600;
        }

        .alert-dot {
          width: 6px;
          height: 6px;
          background-color: var(--pending-orange);
          border-radius: 50%;
        }

        /* All Selector card overrides */
        .all-selector-card {
          justify-content: space-between;
        }

        .all-selector-card .card-stats-layout {
          border-bottom: none;
          padding-bottom: 0;
        }

        /* ── Client List Details ── */
        .client-list-section {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 24px;
          box-shadow: var(--card-shadow);
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .section-header h2 {
          font-size: 1.125rem;
          font-weight: 700;
          color: var(--text-dark);
        }

        .count-badge {
          font-size: 0.75rem;
          font-weight: 600;
          background-color: var(--workspace-bg);
          color: var(--text-muted);
          padding: 4px 10px;
          border-radius: 9999px;
          border: 1px solid var(--border-gray);
        }

        .empty-results {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          text-align: center;
          background-color: var(--workspace-bg);
          border-radius: 8px;
          border: 1px dashed var(--border-gray);
        }

        .empty-icon {
          font-size: 2.25rem;
          margin-bottom: 12px;
          color: var(--text-light);
        }

        .empty-results h3 {
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--text-dark);
          margin-bottom: 4px;
        }

        .empty-results p {
          font-size: 0.8125rem;
          color: var(--text-muted);
        }

        /* Table components */
        .table-card {
          border: 1px solid var(--border-gray);
          border-radius: 8px;
          overflow: hidden;
        }

        .ops-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.875rem;
        }

        .ops-table th {
          background-color: var(--workspace-bg);
          padding: 14px 20px;
          font-weight: 600;
          color: var(--text-muted);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 1px solid var(--border-gray);
        }

        .ops-table td {
          padding: 14px 20px;
          border-bottom: 1px solid var(--border-gray);
          vertical-align: middle;
        }

        .table-row-hover:hover {
          background-color: rgba(248, 250, 252, 0.5);
        }

        .client-email {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-top: 1px;
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

        /* Sync volume display */
        .sync-stats {
          display: flex;
          align-items: baseline;
          gap: 4px;
        }

        .sync-lbl {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        /* Badges & Status Pills */
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

        .badge {
          display: inline-flex;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .badge-urgent {
          background-color: var(--urgent-red-bg);
          color: var(--urgent-red);
        }

        .badge-clean {
          background-color: var(--success-green-bg);
          color: var(--success-green);
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

        /* Reusable buttons */
        .btn {
          padding: 8px 16px;
          font-size: 0.8125rem;
          font-weight: 600;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          transition: background-color 0.2s, border-color 0.2s;
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

        /* Mobile views */
        .mobile-cards-list {
          display: none;
        }

        /* ── Modal dialog overrides ── */
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

        /* ── Responsive rules ── */

        /* Laptop (1024px - 1440px) */
        @media (max-width: 1439px) {
          .advisor-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        /* Tablet (768px - 1023px) */
        @media (max-width: 1023px) {
          .advisor-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .summary-ribbon {
            grid-template-columns: repeat(2, 1fr);
          }
          .summary-card:last-child {
            grid-column: span 2;
          }
        }

        /* Mobile (Below 768px) */
        @media (max-width: 767px) {
          .page-header {
            flex-direction: column;
            align-items: flex-start;
          }

          .header-button-group {
            width: 100%;
          }

          .header-button-group .btn {
            flex: 1;
            display: flex;
            justify-content: center;
          }

          .summary-ribbon {
            grid-template-columns: 1fr;
          }

          .summary-card:last-child {
            grid-column: span 1;
          }

          .control-panel {
            flex-direction: column;
            align-items: flex-start;
          }

          .search-box {
            max-width: 100%;
            width: 100%;
          }

          .sort-group {
            width: 100%;
            justify-content: space-between;
          }

          .advisor-grid {
            grid-template-columns: 1fr;
          }

          .table-card {
            display: none; /* Hide table on mobile */
          }

          .mobile-cards-list {
            display: flex;
            flex-direction: column;
            gap: 16px;
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
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 1px solid var(--border-gray);
            padding-bottom: 12px;
            gap: 12px;
          }

          .card-top-row > div:first-child {
            min-width: 0;
            flex: 1;
          }

          .m-client-name {
            font-size: 0.95rem;
            font-weight: 700;
            color: var(--text-dark);
          }

          .m-client-email {
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-top: 1px;
            word-break: break-all;
            overflow-wrap: break-word;
          }

          .m-card-body-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }

          .m-body-lbl {
            font-size: 0.6875rem;
            color: var(--text-muted);
            text-transform: uppercase;
            font-weight: 600;
          }

          .m-body-val {
            font-size: 0.8125rem;
            color: var(--text-dark);
            margin-top: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .m-card-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-top: 1px solid var(--border-gray);
            padding-top: 12px;
          }

          .m-stats {
            display: flex;
            flex-direction: column;
            gap: 2px;
            font-size: 0.75rem;
            color: var(--text-muted);
          }
        }
      `}</style>
    </div>
  );
}
