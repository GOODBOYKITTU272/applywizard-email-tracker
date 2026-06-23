"use client";

import React, { useState } from "react";
import Link from "next/link";
import { mockApplications, mockClients, mockCAs } from "@/lib/mockData";

export default function OverviewPage() {
  const [selectedCA, setSelectedCA] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");

  // ── Data Calculations ────────────────────────────────────────────────────────
  const totalEmails = mockApplications.length;
  const totalAppsCount = mockApplications.filter(
    (a) => a.category === "application_received"
  ).length;
  const interviewsCount = mockApplications.filter(
    (a) => a.category === "interview_invite"
  ).length;
  const assessmentsCount = mockApplications.filter(
    (a) => a.category === "assessment"
  ).length;
  const rejectionsCount = mockApplications.filter(
    (a) => a.category === "rejection"
  ).length;
  const reviewRequiredCount = mockApplications.filter(
    (a) => a.needsHumanReview
  ).length;

  // Filtered list for "Attention Needed" (e.g. Needs Human Review & High Priority Categories)
  const attentionItems = mockApplications
    .filter((a) => a.needsHumanReview)
    .slice(0, 4);

  // Recent Emails List (latest 5)
  const recentEmails = mockApplications.slice(0, 5);

  // Top Categories counts
  const categoryCounts = mockApplications.reduce((acc, curr) => {
    acc[curr.category] = (acc[curr.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sortedCategories = Object.entries(categoryCounts)
    .map(([cat, count]) => ({ category: cat, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  // Mailbox Health status counts
  const healthyCount = mockClients.filter((c) => c.mailboxStatus === "healthy").length;
  const issueCount = mockClients.filter((c) => c.mailboxStatus === "needs_reconnect").length;

  return (
    <div className="overview-container">
      {/* ── Filter & Control Bar ── */}
      <section className="filter-bar-card">
        <div className="filter-group">
          <div className="select-wrapper">
            <label htmlFor="ca-select">CA Profile</label>
            <select
              id="ca-select"
              value={selectedCA}
              onChange={(e) => setSelectedCA(e.target.value)}
            >
              <option value="all">All CAs</option>
              {mockCAs.map((ca) => (
                <option key={ca.id} value={ca.id}>
                  {ca.name}
                </option>
              ))}
            </select>
          </div>

          <div className="select-wrapper">
            <label htmlFor="status-select">Mailbox Status</label>
            <select
              id="status-select"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="all">All Mailboxes</option>
              <option value="healthy">Healthy Only</option>
              <option value="issue">Needs Attention</option>
            </select>
          </div>
        </div>

        <div className="sync-info">
          <span className="last-sync">Last synced: 2 mins ago</span>
          <button
            className="btn btn-secondary btn-icon"
            onClick={() => alert("Syncing operations feed...")}
          >
            🔄 Refresh Feed
          </button>
        </div>
      </section>

      {/* ── Metric Grid ── */}
      <section className="metrics-grid">
        <Link href="/applications" className="metric-card">
          <div className="metric-meta">
            <span className="metric-icon">📧</span>
            <span className="metric-title">Total Emails</span>
          </div>
          <div className="metric-value">{totalEmails}</div>
          <div className="metric-trend text-muted">All synced headers</div>
        </Link>

        <Link href="/applications?category=application_received" className="metric-card">
          <div className="metric-meta">
            <span className="metric-icon">📁</span>
            <span className="metric-title">Applications</span>
          </div>
          <div className="metric-value">{totalAppsCount}</div>
          <div className="metric-trend text-success">Active submissions</div>
        </Link>

        <Link href="/applications?category=interview_invite" className="metric-card">
          <div className="metric-meta">
            <span className="metric-icon">🤝</span>
            <span className="metric-title">Interviews</span>
          </div>
          <div className="metric-value">{interviewsCount}</div>
          <div className="metric-trend text-success">Invites received</div>
        </Link>

        <Link href="/applications?category=assessment" className="metric-card">
          <div className="metric-meta">
            <span className="metric-icon">📝</span>
            <span className="metric-title">Assessments</span>
          </div>
          <div className="metric-value">{assessmentsCount}</div>
          <div className="metric-trend text-pending">Deadlines pending</div>
        </Link>

        <Link href="/applications?category=rejection" className="metric-card">
          <div className="metric-meta">
            <span className="metric-icon">❌</span>
            <span className="metric-title">Rejections</span>
          </div>
          <div className="metric-value">{rejectionsCount}</div>
          <div className="metric-trend text-muted">Closed listings</div>
        </Link>

        <Link href="/review-queue" className="metric-card highlight-urgent">
          <div className="metric-meta">
            <span className="metric-icon">⚠️</span>
            <span className="metric-title">Review Required</span>
          </div>
          <div className="metric-value text-urgent">{reviewRequiredCount}</div>
          <div className="metric-trend text-urgent font-bold">Needs CA action</div>
        </Link>
      </section>

      {/* ── Main Panel Grid ── */}
      <div className="overview-main-grid">
        {/* Left Side: Attention Needed & Recent Activity */}
        <div className="main-left-column">
          {/* Attention Needed */}
          <div className="content-card">
            <div className="card-header">
              <h2>⚠️ Action Required Queue</h2>
              <Link href="/review-queue" className="header-link">
                View Review Queue →
              </Link>
            </div>
            <div className="attention-list">
              {attentionItems.map((item) => (
                <div key={item.id} className="attention-item">
                  <div className="attention-meta">
                    <span className={`badge badge-${item.category}`}>
                      {item.category.replace("_", " ")}
                    </span>
                    <span className="attention-client">{item.clientName}</span>
                  </div>
                  <h4 className="attention-subject">{item.subject}</h4>
                  {item.deadline && (
                    <div className="attention-deadline">
                      <span>Due: </span>
                      <strong className="text-urgent">{item.deadline}</strong>
                    </div>
                  )}
                  <div className="attention-action">
                    <span>Task: </span>
                    {item.actionRequired}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Email Activity */}
          <div className="content-card">
            <div className="card-header">
              <h2>Recent Email Logs</h2>
              <Link href="/applications" className="header-link">
                View All Emails →
              </Link>
            </div>
            <div className="table-wrapper">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Subject</th>
                    <th>Folder</th>
                    <th>Category</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEmails.map((email) => (
                    <tr key={email.id} className="table-row-hover">
                      <td>
                        <div className="client-name-lbl">{email.clientName}</div>
                        <div className="client-mailbox-lbl">{email.mailbox}</div>
                      </td>
                      <td className="cell-subject">{email.subject}</td>
                      <td>{email.folderName}</td>
                      <td>
                        <span className={`badge badge-${email.category}`}>
                          {email.category.replace("_", " ")}
                        </span>
                      </td>
                      <td className="font-tabular">{(email.confidence * 100).toFixed(0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile-Only Client Cards (Transform table for mobile) */}
            <div className="mobile-only-cards">
              {recentEmails.map((email) => (
                <div key={email.id} className="mobile-client-card">
                  <div className="mobile-card-header">
                    <div>
                      <div className="m-client-name">{email.clientName}</div>
                      <div className="m-client-mailbox">{email.mailbox}</div>
                    </div>
                    <span className={`badge badge-${email.category}`}>
                      {email.category.replace("_", " ")}
                    </span>
                  </div>
                  <div className="m-card-subject">{email.subject}</div>
                  <div className="m-card-meta">
                    <span>Folder: <strong>{email.folderName}</strong></span>
                    <span>Confidence: <strong>{(email.confidence * 100).toFixed(0)}%</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side: Charts & Quick Actions */}
        <div className="main-right-column">
          {/* Chart: Activity */}
          <div className="content-card">
            <h3>Email Volumes (Last 7 Days)</h3>
            <div className="bar-chart-container">
              <div className="chart-bar-y">
                <div className="chart-bar" style={{ height: "65%" }}>
                  <span className="bar-val">12</span>
                </div>
                <span className="bar-lbl">Wed</span>
              </div>
              <div className="chart-bar-y">
                <div className="chart-bar" style={{ height: "80%" }}>
                  <span className="bar-val">15</span>
                </div>
                <span className="bar-lbl">Thu</span>
              </div>
              <div className="chart-bar-y">
                <div className="chart-bar" style={{ height: "45%" }}>
                  <span className="bar-val">8</span>
                </div>
                <span className="bar-lbl">Fri</span>
              </div>
              <div className="chart-bar-y">
                <div className="chart-bar" style={{ height: "20%" }}>
                  <span className="bar-val">3</span>
                </div>
                <span className="bar-lbl">Sat</span>
              </div>
              <div className="chart-bar-y">
                <div className="chart-bar" style={{ height: "15%" }}>
                  <span className="bar-val">2</span>
                </div>
                <span className="bar-lbl">Sun</span>
              </div>
              <div className="chart-bar-y">
                <div className="chart-bar" style={{ height: "90%" }}>
                  <span className="bar-val">18</span>
                </div>
                <span className="bar-lbl">Mon</span>
              </div>
              <div className="chart-bar-y">
                <div className="chart-bar" style={{ height: "75%" }}>
                  <span className="bar-val">14</span>
                </div>
                <span className="bar-lbl">Tue</span>
              </div>
            </div>
          </div>

          {/* Mailbox Connection Health */}
          <div className="content-card">
            <h3>Mailbox Connection Status</h3>
            <div className="health-distribution">
              <div className="health-status-row">
                <div className="status-indicator-green" />
                <span className="status-label">Active & Healthy</span>
                <span className="status-count font-tabular">{healthyCount}</span>
              </div>
              <div className="health-status-row">
                <div className="status-indicator-orange" />
                <span className="status-label">Needs Reconnection</span>
                <span className="status-count font-tabular">{issueCount}</span>
              </div>
            </div>
            <div className="health-progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(healthyCount / (healthyCount + issueCount)) * 100}%` }}
              />
            </div>
          </div>

          {/* Top Categories */}
          <div className="content-card">
            <h3>Top Email Categories</h3>
            <div className="category-list">
              {sortedCategories.map(({ category, count }) => (
                <div key={category} className="category-row">
                  <span className="category-name">{category.replace("_", " ")}</span>
                  <div className="category-bar-wrapper">
                    <div
                      className="category-bar"
                      style={{ width: `${(count / totalEmails) * 100}%` }}
                    />
                  </div>
                  <span className="category-count font-tabular">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions Panel */}
          <div className="content-card">
            <h3>Quick Operations Actions</h3>
            <div className="quick-actions-grid">
              <Link href="/applications" className="action-btn-link">
                📁 Browse Applications
              </Link>
              <Link href="/review-queue" className="action-btn-link">
                📥 Review Queue
              </Link>
              <Link href="/clients" className="action-btn-link">
                👥 Clients & Mailboxes
              </Link>
              <Link href="/mailboxes" className="action-btn-link">
                🔌 Connection Status
              </Link>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .overview-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* ── Filter Bar Card ── */
        .filter-bar-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 16px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
          box-shadow: var(--card-shadow);
        }

        .filter-group {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
        }

        .select-wrapper {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .select-wrapper label {
          font-size: 0.75rem;
          color: var(--text-muted);
          font-weight: 600;
          text-transform: uppercase;
        }

        .select-wrapper select {
          padding: 8px 12px;
          border-radius: 6px;
          border: 1px solid var(--border-gray);
          background-color: var(--white);
          color: var(--text-dark);
          font-size: 0.875rem;
          font-weight: 500;
          outline: none;
          min-width: 160px;
        }

        .sync-info {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .last-sync {
          font-size: 0.8125rem;
          color: var(--text-muted);
        }

        .btn {
          padding: 8px 16px;
          font-size: 0.875rem;
          font-weight: 600;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .btn-secondary {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          color: var(--text-dark);
        }

        .btn-secondary:hover {
          background-color: var(--workspace-bg);
        }

        /* ── Metrics Grid ── */
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 16px;
        }

        .metric-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 20px;
          text-decoration: none;
          color: inherit;
          display: flex;
          flex-direction: column;
          gap: 8px;
          transition: box-shadow 0.2s, border-color 0.2s, transform 0.2s;
          box-shadow: var(--card-shadow);
        }

        .metric-card:hover {
          box-shadow: var(--card-shadow-hover);
          border-color: var(--primary-blue);
          transform: translateY(-2px);
        }

        .metric-card.highlight-urgent {
          border-left: 4px solid var(--urgent-red);
        }

        .metric-meta {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .metric-icon {
          font-size: 1.25rem;
        }

        .metric-title {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-muted);
        }

        .metric-value {
          font-size: 2rem;
          font-weight: 700;
          font-family: var(--font-display);
        }

        .metric-trend {
          font-size: 0.75rem;
        }

        .text-success { color: var(--success-green); }
        .text-pending { color: var(--pending-orange); }
        .text-urgent { color: var(--urgent-red); }
        .font-bold { font-weight: 700; }
        .font-tabular { font-feature-settings: "tnum"; }

        /* ── Main Content Grid ── */
        .overview-main-grid {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 24px;
        }

        .main-left-column,
        .main-right-column {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .content-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 24px;
          box-shadow: var(--card-shadow);
        }

        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 20px;
        }

        .card-header h2 {
          font-size: 1.125rem;
          font-weight: 700;
        }

        .header-link {
          font-size: 0.8125rem;
          color: var(--primary-blue);
          text-decoration: none;
          font-weight: 600;
        }

        .header-link:hover {
          text-decoration: underline;
        }

        /* ── Attention List ── */
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

        .attention-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .attention-client {
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-muted);
        }

        .attention-subject {
          font-size: 0.9375rem;
          font-weight: 600;
          color: var(--text-dark);
        }

        .attention-deadline {
          font-size: 0.8125rem;
        }

        .attention-action {
          font-size: 0.8125rem;
          color: var(--text-muted);
          border-top: 1px solid var(--border-gray);
          padding-top: 6px;
          margin-top: 4px;
        }

        /* ── Reusable Status Badges ── */
        .badge {
          display: inline-flex;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
        }

        .badge-interview_invite {
          background-color: var(--pending-orange-bg);
          color: var(--pending-orange);
        }

        .badge-assessment {
          background-color: var(--urgent-red-bg);
          color: var(--urgent-red);
        }

        .badge-recruiter_reply,
        .badge-follow_up_needed {
          background-color: var(--pending-orange-bg);
          color: var(--pending-orange);
        }

        .badge-application_received {
          background-color: #e2e8f0;
          color: var(--text-muted);
        }

        .badge-rejection {
          background-color: #fee2e2;
          color: #ef4444;
        }

        .badge-job_offer {
          background-color: var(--success-green-bg);
          color: var(--success-green);
        }

        .badge-email_verification,
        .badge-otp_verification {
          background-color: #dbeafe;
          color: var(--primary-blue);
        }

        /* ── Operations Table ── */
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
          padding: 16px;
          border-bottom: 1px solid var(--border-gray);
        }

        .table-row-hover:hover {
          background-color: var(--workspace-bg);
        }

        .client-name-lbl {
          font-weight: 600;
          color: var(--text-dark);
        }

        .client-mailbox-lbl {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .cell-subject {
          max-width: 260px;
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
          font-weight: 500;
        }

        /* ── Bar Chart Styling (CSS-only) ── */
        .bar-chart-container {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          height: 160px;
          padding-top: 20px;
          margin-top: 16px;
        }

        .chart-bar-y {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          height: 100%;
          justify-content: flex-end;
        }

        .chart-bar {
          background-color: var(--primary-blue);
          border-radius: 4px 4px 0 0;
          width: 24px;
          position: relative;
          display: flex;
          justify-content: center;
          transition: height 0.5s ease;
        }

        .bar-val {
          position: absolute;
          top: -20px;
          font-size: 0.6875rem;
          font-weight: 700;
          color: var(--text-muted);
        }

        .bar-lbl {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        /* ── Mailbox Health Status ── */
        .health-distribution {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin: 16px 0;
        }

        .health-status-row {
          display: flex;
          align-items: center;
          font-size: 0.875rem;
        }

        .status-indicator-green {
          width: 8px;
          height: 8px;
          background-color: var(--success-green);
          border-radius: 50%;
          margin-right: 10px;
        }

        .status-indicator-orange {
          width: 8px;
          height: 8px;
          background-color: var(--pending-orange);
          border-radius: 50%;
          margin-right: 10px;
        }

        .status-label {
          color: var(--text-dark);
          flex: 1;
        }

        .status-count {
          font-weight: 600;
          color: var(--text-muted);
        }

        .health-progress-bar {
          height: 8px;
          background-color: var(--border-gray);
          border-radius: 4px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background-color: var(--success-green);
          border-radius: 4px;
        }

        /* ── Top Categories List ── */
        .category-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 16px;
        }

        .category-row {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 0.8125rem;
        }

        .category-name {
          width: 110px;
          font-weight: 600;
          color: var(--text-dark);
          text-transform: capitalize;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .category-bar-wrapper {
          flex: 1;
          height: 6px;
          background-color: var(--border-gray);
          border-radius: 3px;
        }

        .category-bar {
          height: 100%;
          background-color: var(--primary-blue);
          border-radius: 3px;
        }

        .category-count {
          font-weight: 600;
          color: var(--text-muted);
          width: 20px;
          text-align: right;
        }

        /* ── Quick Actions Grid ── */
        .quick-actions-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          margin-top: 16px;
        }

        .action-btn-link {
          background-color: var(--workspace-bg);
          border: 1px solid var(--border-gray);
          border-radius: 8px;
          padding: 12px;
          text-decoration: none;
          color: var(--text-dark);
          font-size: 0.8125rem;
          font-weight: 600;
          text-align: center;
          transition: background-color 0.2s, border-color 0.2s;
        }

        .action-btn-link:hover {
          background-color: var(--white);
          border-color: var(--primary-blue);
        }

        .mobile-only-cards {
          display: none;
        }

        /* ── Responsive Modifications ── */

        /* Laptop (1024px - 1439px) */
        @media (max-width: 1439px) {
          .metrics-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        /* Tablet (768px - 1023px) */
        @media (max-width: 1023px) {
          .overview-main-grid {
            grid-template-columns: 1fr; /* Stack columns */
          }
        }

        /* Mobile (Below 768px) */
        @media (max-width: 767px) {
          .metrics-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .metric-card {
            padding: 14px;
          }

          .metric-value {
            font-size: 1.5rem;
          }

          .ops-table {
            display: none; /* Hide squeezed table on mobile */
          }

          /* Show Mobile Client Cards instead of table */
          .mobile-only-cards {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-top: 16px;
          }

          .mobile-client-card {
            background-color: var(--white);
            border: 1px solid var(--border-gray);
            border-radius: 8px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .mobile-card-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
          }

          .m-client-name {
            font-weight: 700;
            font-size: 0.875rem;
            color: var(--text-dark);
          }

          .m-client-mailbox {
            font-size: 0.75rem;
            color: var(--text-muted);
          }

          .m-card-subject {
            font-size: 0.8125rem;
            font-weight: 600;
            color: var(--text-dark);
            line-height: 1.4;
          }

          .m-card-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 0.75rem;
            color: var(--text-muted);
            border-top: 1px solid var(--border-gray);
            padding-top: 8px;
          }

          .quick-actions-grid {
            grid-template-columns: 1fr; /* Full width actions */
          }
        }
      `}</style>
    </div>
  );
}
