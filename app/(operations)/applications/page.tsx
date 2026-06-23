"use client";

import React, { useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { mockApplications, mockClients, mockCAs } from "@/lib/mockData";
import { classifyApplications, JOB_CATEGORIES } from "@/lib/classify/classifyMockEmails";

function ApplicationsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Default values from query params (e.g. if navigated from metric card clicks)
  const initialCategory = searchParams.get("category") || "all";

  // ── States ──────────────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCA, setSelectedCA] = useState("all");
  const [selectedClient, setSelectedClient] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const [selectedStatus, setSelectedStatus] = useState("all");

  // ── Derived classification (single source of truth) ─────────────────────────
  const classifiedApps = useMemo(
    () => classifyApplications(mockApplications),
    []
  );

  // ── Filtering Logic ─────────────────────────────────────────────────────────
  const filteredApps = useMemo(() => {
    return classifiedApps.filter((app) => {
      // Default view: job-related categories only (no OTP, system, verification, spam)
      const isJobCategory = JOB_CATEGORIES.includes(app.derived.category);
      if (!isJobCategory && selectedCategory === "all") return false;

      // 1. Search term match
      const matchesSearch =
        searchTerm === "" ||
        app.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.jobTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.sender.toLowerCase().includes(searchTerm.toLowerCase());

      // 2. CA match
      const matchesCA = selectedCA === "all" || app.caId === selectedCA;

      // 3. Client match
      const matchesClient = selectedClient === "all" || app.clientId === selectedClient;

      // 4. Category match (derived)
      const matchesCategory =
        selectedCategory === "all" || app.derived.category === selectedCategory;

      // 5. Status match (derived needs_human_review)
      const matchesStatus =
        selectedStatus === "all" ||
        (selectedStatus === "classified" && !app.derived.needs_human_review) ||
        (selectedStatus === "review" && app.derived.needs_human_review) ||
        (selectedStatus === "failed" && app.status === "failed");

      return matchesSearch && matchesCA && matchesClient && matchesCategory && matchesStatus;
    });
  }, [searchTerm, selectedCA, selectedClient, selectedCategory, selectedStatus, classifiedApps]);

  return (
    <div className="apps-page-container">
      {/* Page Header */}
      <header className="page-header-section">
        <div>
          <h1 className="page-title">Synced Email Submissions</h1>
          <p className="page-subtitle">
            Manage applications, client advisor portfolios, and automated classification queues.
          </p>
        </div>
      </header>

      {/* Filter and Search controls */}
      <section className="search-filter-card">
        <div className="search-bar-wrapper">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search company, job title, subject, sender..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-options-grid">
          <div className="filter-select-wrapper">
            <select value={selectedCA} onChange={(e) => setSelectedCA(e.target.value)}>
              <option value="all">All CAs</option>
              {mockCAs.map((ca) => (
                <option key={ca.id} value={ca.id}>
                  CA: {ca.name}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-select-wrapper">
            <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
              <option value="all">All Clients</option>
              {mockClients.map((client) => (
                <option key={client.id} value={client.id}>
                  Client: {client.name}
                </option>
              ))}
            </select>
          </div>

          <div className="filter-select-wrapper">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="all">All Categories</option>
              <option value="application_received">Application Received</option>
              <option value="assessment">Assessment Request</option>
              <option value="interview_invite">Interview Invite</option>
              <option value="rejection">Rejections</option>
              <option value="job_offer">Job Offers</option>
              <option value="recruiter_reply">Recruiter Reply</option>
              <option value="follow_up_needed">Follow-Up Needed</option>
              <option value="otp_verification">OTP Code</option>
              <option value="email_verification">Email Verification</option>
              <option value="account_created">Account Welcome</option>
              <option value="unknown">Unknown Category</option>
            </select>
          </div>

          <div className="filter-select-wrapper">
            <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="classified">Auto-Classified</option>
              <option value="review">Needs CA Review</option>
              <option value="failed">Classification Failed</option>
            </select>
          </div>
        </div>
      </section>

      {/* Applications Data Grid */}
      <section className="results-container">
        {filteredApps.length === 0 ? (
          <div className="empty-results-card">
            <span className="empty-icon">📂</span>
            <h3>No Submissions Found</h3>
            <p>No results match your search and filter criteria. Try clearing filters.</p>
            <button
              className="btn btn-primary"
              onClick={() => {
                setSearchTerm("");
                setSelectedCA("all");
                setSelectedClient("all");
                setSelectedCategory("all");
                setSelectedStatus("all");
                router.replace("/applications");
              }}
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="table-card">
              <table className="apps-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Job Title & Company</th>
                    <th>Email Subject</th>
                    <th>Folder</th>
                    <th>Category</th>
                    <th>Confidence</th>
                    <th>Action Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApps.map((app) => (
                    <tr
                      key={app.id}
                      className="table-row-clickable"
                      onClick={() => router.push(`/applications/${app.id}`)}
                    >
                      <td>
                        <div className="client-name">{app.clientName}</div>
                        <div className="client-ca">{app.caName}</div>
                      </td>
                      <td>
                        <div className="job-role">{app.jobTitle}</div>
                        <div className="company-name">{app.companyName}</div>
                      </td>
                      <td className="cell-subject-line">
                        <div className="subject-text" title={app.subject}>
                          {app.subject}
                        </div>
                        <div className="sender-text" title={app.sender}>
                          {app.sender}
                        </div>
                      </td>
                      <td>
                        <span className="folder-tag">{app.folderName}</span>
                      </td>
                      <td>
                        <span className={`badge badge-${app.derived.category}`}>
                          {app.derived.category.replace("_", " ")}
                        </span>
                      </td>
                      <td className="font-tabular">{(app.derived.confidence * 100).toFixed(0)}%</td>
                      <td>
                        {app.derived.needs_human_review ? (
                          <span className="action-tag tag-urgent">⚠️ Needs Review</span>
                        ) : (
                          <span className="action-tag tag-success">✓ Auto-OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="mobile-cards-list">
              {filteredApps.map((app) => (
                <div
                  key={app.id}
                  className="mobile-app-card"
                  onClick={() => router.push(`/applications/${app.id}`)}
                >
                  <div className="card-top-row">
                    <div>
                      <div className="m-client">{app.clientName}</div>
                      <div className="m-ca">CA: {app.caName}</div>
                    </div>
                    <span className={`badge badge-${app.derived.category}`}>
                      {app.derived.category.replace("_", " ")}
                    </span>
                  </div>

                  <div className="card-mid-row">
                    <div className="m-job-details">
                      <strong>{app.jobTitle}</strong> at {app.companyName}
                    </div>
                    <div className="m-subject">{app.subject}</div>
                  </div>

                  <div className="card-bottom-row">
                    <span className="folder-tag">{app.folderName}</span>
                    {app.derived.needs_human_review ? (
                      <span className="action-tag tag-urgent">⚠️ Review</span>
                    ) : (
                      <span className="action-tag tag-success">✓ Auto-OK</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <style jsx>{`
        .apps-page-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .page-header-section {
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

        /* ── Search & Filter Cards ── */
        .search-filter-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-shadow: var(--card-shadow);
        }

        .search-bar-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 16px;
          border: 1px solid var(--border-gray);
          border-radius: 8px;
          background-color: var(--workspace-bg);
          min-width: 0;
        }

        .search-icon {
          font-size: 1.15rem;
          color: var(--text-light);
        }

        .search-bar-wrapper input {
          border: none;
          background: none;
          outline: none;
          width: 100%;
          min-width: 0;
          color: var(--text-dark);
          font-size: 0.925rem;
          font-family: var(--font-display);
        }

        .filter-options-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }

        .filter-select-wrapper select {
          width: 100%;
          padding: 10px 14px;
          border-radius: 8px;
          border: 1px solid var(--border-gray);
          background-color: var(--white);
          color: var(--text-dark);
          font-size: 0.875rem;
          font-weight: 500;
          outline: none;
          cursor: pointer;
        }

        /* ── Results Grid & Layouts ── */
        .results-container {
          width: 100%;
        }

        .table-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          box-shadow: var(--card-shadow);
          overflow: hidden;
        }

        .apps-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.875rem;
        }

        .apps-table th {
          padding: 14px 20px;
          color: var(--text-muted);
          font-weight: 600;
          border-bottom: 1px solid var(--border-gray);
          background-color: rgba(248, 250, 252, 0.5);
        }

        .apps-table td {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-gray);
          vertical-align: middle;
        }

        .table-row-clickable {
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .table-row-clickable:hover {
          background-color: var(--workspace-bg);
        }

        .client-name {
          font-weight: 700;
          color: var(--text-dark);
        }

        .client-ca {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .job-role {
          font-weight: 600;
          color: var(--text-dark);
        }

        .company-name {
          font-size: 0.8125rem;
          color: var(--text-muted);
        }

        .cell-subject-line {
          max-width: 320px;
        }

        .subject-text {
          font-weight: 600;
          color: var(--text-dark);
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        .sender-text {
          font-size: 0.75rem;
          color: var(--text-muted);
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
          margin-top: 2px;
        }

        .folder-tag {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-muted);
          background-color: var(--border-gray);
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
        }

        .font-tabular {
          font-feature-settings: "tnum";
        }

        .action-tag {
          display: inline-flex;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .tag-urgent {
          background-color: var(--urgent-red-bg);
          color: var(--urgent-red);
          border: 1px solid rgba(220, 38, 38, 0.15);
        }

        .tag-success {
          background-color: var(--success-green-bg);
          color: var(--success-green);
          border: 1px solid rgba(22, 163, 74, 0.15);
        }

        /* Reusable badges */
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

        /* ── Reusable Empty state card ── */
        .empty-results-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 48px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          box-shadow: var(--card-shadow);
        }

        .empty-icon {
          font-size: 3rem;
        }

        .empty-results-card h3 {
          font-size: 1.25rem;
          font-weight: 700;
        }

        .empty-results-card p {
          color: var(--text-muted);
          font-size: 0.925rem;
          max-width: 320px;
          line-height: 1.5;
          margin-bottom: 8px;
        }

        .btn-primary {
          background-color: var(--primary-blue);
          color: var(--white);
        }

        .btn-primary:hover {
          background-color: var(--primary-blue-hover);
        }

        .btn {
          padding: 10px 20px;
          font-size: 0.875rem;
          font-weight: 600;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .mobile-cards-list {
          display: none;
        }

        /* ── Responsive Rules ── */

        /* Laptop (1024px - 1439px) */
        @media (max-width: 1439px) {
          .filter-options-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }

        /* Tablet (768px - 1023px) */
        @media (max-width: 1023px) {
          .apps-table th:nth-child(4),
          .apps-table td:nth-child(4),
          .apps-table th:nth-child(6),
          .apps-table td:nth-child(6) {
            display: none; /* Hide folder & confidence to prevent layout breaks */
          }
        }

        /* Mobile (Below 768px) */
        @media (max-width: 767px) {
          .search-filter-card {
            padding: 16px;
          }

          .filter-options-grid {
            grid-template-columns: 1fr;
          }

          .table-card {
            display: none; /* Hide table on mobile */
          }

          .mobile-cards-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .mobile-app-card {
            background-color: var(--white);
            border: 1px solid var(--border-gray);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            box-shadow: var(--card-shadow);
            cursor: pointer;
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

          .m-client {
            font-weight: 700;
            font-size: 0.875rem;
            color: var(--text-dark);
          }

          .m-ca {
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-top: 2px;
          }

          .card-mid-row {
            display: flex;
            flex-direction: column;
            gap: 4px;
          }

          .m-job-details {
            font-size: 0.875rem;
            color: var(--text-dark);
          }

          .m-subject {
            font-size: 0.8125rem;
            color: var(--text-muted);
            line-height: 1.4;
          }

          .card-bottom-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-top: 1px solid var(--border-gray);
            padding-top: 10px;
          }
        }
      `}</style>
    </div>
  );
}

export default function ApplicationsPage() {
  return (
    <Suspense fallback={<div className="loading-state">Loading applications list...</div>}>
      <ApplicationsContent />
    </Suspense>
  );
}
