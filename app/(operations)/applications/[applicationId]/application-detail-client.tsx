"use client";

import React, { useState, use } from "react";
import Link from "next/link";
import { mockApplications } from "@/lib/mockData";
import { classifyEmail } from "@/lib/classify/emailClassification";

interface PageProps {
  params: Promise<{ applicationId: string }>;
}

export default function ApplicationDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const applicationId = resolvedParams.applicationId;

  // Find the mock application
  const app = mockApplications.find((a) => a.id === applicationId);

  // Local state for interactive "Mark Reviewed" mock toggle
  const [isReviewed, setIsReviewed] = useState(false);
  const [showWhySection, setShowWhySection] = useState(false);

  // Derived classification for this record
  const derived = app
    ? classifyEmail({
        subject: app.subject,
        body: app.body,
        sender: app.sender,
        receivedDate: app.receivedDate,
      })
    : null;

  if (!app) {
    return (
      <div className="detail-error-card">
        <h3>Application Not Found</h3>
        <p>The application record with ID &ldquo;{applicationId}&rdquo; does not exist.</p>
        <Link href="/applications" className="btn btn-primary">
          Back to Applications
        </Link>
      </div>
    );
  }

  const receivedDate = new Date(app.receivedDate).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="detail-page-container">
      {/* Back navigation header */}
      <header className="detail-header">
        <Link href="/applications" className="back-link">
          ← Back to Applications
        </Link>
        <div className="header-actions">
          <Link href={`/clients/${app.clientId}`} className="btn btn-secondary">
            👤 Client Dashboard
          </Link>
          <button
            className={`btn ${isReviewed ? "btn-success-solid" : "btn-primary"}`}
            onClick={() => {
              setIsReviewed(!isReviewed);
            }}
          >
            {isReviewed ? "✓ Reviewed & Logged" : "Mark as Reviewed"}
          </button>
        </div>
      </header>

      {/* Main Details Layout */}
      <div className="detail-main-layout">
        {/* Left Column: Email Subject & Body Preview */}
        <div className="layout-left-col">
          <div className="email-preview-card">
            <div className="email-headers-section">
              <div className="header-row">
                <span className="header-label">From:</span>
                <span className="header-value font-semibold">{app.sender}</span>
              </div>
              <div className="header-row">
                <span className="header-label">To:</span>
                <span className="header-value">{app.mailbox}</span>
              </div>
              <div className="header-row">
                <span className="header-label">Date:</span>
                <span className="header-value">{receivedDate}</span>
              </div>
              <div className="header-row border-top-line">
                <span className="header-label">Subject:</span>
                <span className="header-value subject-value">{app.subject}</span>
              </div>
            </div>

            {/* Safe Email Body Preview Area */}
            <div className="email-body-preview">
              <pre className="raw-email-body">{app.body}</pre>
            </div>
          </div>
        </div>

        {/* Right Column: Classification Metadata */}
        <div className="layout-right-col">
          {/* Metadata Card */}
          <div className="meta-card">
            <h3>Classification Results</h3>

            <div className="meta-info-list">
              <div className="meta-info-row">
                <span className="info-label">Category:</span>
                <span className={`badge badge-${derived?.category ?? app.category}`}>
                  {(derived?.category ?? app.category).replace("_", " ")}
                </span>
              </div>

              <div className="meta-info-row">
                <span className="info-label">Confidence:</span>
                <span className="info-value font-tabular">
                  {((derived?.confidence ?? app.confidence) * 100).toFixed(0)}%
                </span>
              </div>

              <div className="meta-info-row">
                <span className="info-label">Sync Folder:</span>
                <span className="info-value text-capitalize">{app.folderName}</span>
              </div>

              <div className="meta-info-row">
                <span className="info-label">Sync Status:</span>
                <span className={`status-tag status-${app.status}`}>{app.status}</span>
              </div>

              <div className="meta-info-row border-top-line">
                <span className="info-label">Needs CA Review:</span>
                {(derived?.needs_human_review ?? app.needsHumanReview) ? (
                  <span className="review-badge tag-urgent">⚠️ Yes</span>
                ) : (
                  <span className="review-badge tag-success">✓ No (Auto-OK)</span>
                )}
              </div>

              {/* Why classified expandable */}
              <div className="why-classified-section">
                <button
                  className="why-toggle-btn"
                  onClick={() => setShowWhySection((v) => !v)}
                >
                  {showWhySection ? "▲" : "▼"} Why classified this way?
                </button>
                {showWhySection && derived && (
                  <div className="why-content">
                    {derived.reason}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions & Deadlines Card */}
          <div className="meta-card">
            <h3>Operations Actions</h3>

            <div className="meta-info-list">
              {app.actionRequired ? (
                <div className="action-required-box">
                  <div className="action-box-title">Required Action:</div>
                  <p className="action-box-text">{app.actionRequired}</p>
                </div>
              ) : (
                <div className="action-required-box-none">
                  No operational actions required for this classification.
                </div>
              )}

              {(derived?.deadline ?? app.deadline) && (
                <div className="deadline-box">
                  <div className="deadline-box-title">Action Deadline:</div>
                  <strong className="text-urgent font-tabular">📅 {derived?.deadline ?? app.deadline}</strong>
                </div>
              )}
            </div>
          </div>

          {/* Client & CA Card */}
          <div className="meta-card">
            <h3>Client Context</h3>
            <div className="meta-info-list">
              <div className="meta-info-row">
                <span className="info-label">Client Name:</span>
                <span className="info-value font-semibold">{app.clientName}</span>
              </div>
              <div className="meta-info-row">
                <span className="info-label">Client Email:</span>
                <span className="info-value text-sm text-muted">{app.clientEmail}</span>
              </div>
              <div className="meta-info-row border-top-line">
                <span className="info-label">Assigned CA:</span>
                <span className="info-value font-semibold">{app.caName}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .detail-page-container {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* ── Detail Header ── */
        .detail-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 0;
          flex-wrap: wrap;
          gap: 16px;
        }

        .back-link {
          font-size: 0.9375rem;
          color: var(--text-muted);
          text-decoration: none;
          font-weight: 600;
          transition: color 0.2s;
        }

        .back-link:hover {
          color: var(--primary-blue);
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .btn {
          padding: 10px 20px;
          font-size: 0.875rem;
          font-weight: 600;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          transition: background-color 0.2s, color 0.2s;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
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

        .btn-success-solid {
          background-color: var(--success-green);
          color: var(--white);
        }

        /* ── Detail Main Grid Layout ── */
        .detail-main-layout {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 24px;
        }

        .layout-left-col,
        .layout-right-col {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        /* ── Email Preview Card ── */
        .email-preview-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          box-shadow: var(--card-shadow);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .email-headers-section {
          padding: 24px;
          background-color: rgba(248, 250, 252, 0.5);
          border-bottom: 1px solid var(--border-gray);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .header-row {
          display: flex;
          font-size: 0.875rem;
          line-height: 1.4;
        }

        .header-label {
          width: 80px;
          color: var(--text-muted);
          font-weight: 500;
        }

        .header-value {
          color: var(--text-dark);
          flex-shrink: 1;
          word-break: break-all;
        }

        .subject-value {
          font-weight: 700;
          color: var(--text-dark);
        }

        .border-top-line {
          border-top: 1px solid var(--border-gray);
          padding-top: 10px;
          margin-top: 2px;
        }

        .font-semibold {
          font-weight: 600;
        }

        .email-body-preview {
          padding: 24px;
          background-color: var(--white);
          min-height: 320px;
        }

        .raw-email-body {
          font-family: var(--font-display);
          font-size: 0.9375rem;
          line-height: 1.6;
          color: var(--text-dark);
          white-space: pre-wrap;
          word-break: break-word;
        }

        /* ── Right Column Meta Cards ── */
        .meta-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 24px;
          box-shadow: var(--card-shadow);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .meta-card h3 {
          font-size: 1rem;
          font-weight: 700;
          color: var(--text-dark);
          border-bottom: 1px solid var(--border-gray);
          padding-bottom: 10px;
          margin-bottom: 4px;
        }

        .meta-info-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .meta-info-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.875rem;
        }

        .info-label {
          color: var(--text-muted);
          font-weight: 500;
        }

        .info-value {
          color: var(--text-dark);
        }

        .text-capitalize {
          text-transform: capitalize;
        }

        .font-tabular {
          font-feature-settings: "tnum";
        }

        /* Badges & Tags */
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

        .status-tag {
          display: inline-flex;
          padding: 2px 8px;
          border-radius: 6px;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
        }

        .status-tag.status-classified {
          background-color: var(--success-green-bg);
          color: var(--success-green);
        }

        .status-tag.status-failed {
          background-color: var(--urgent-red-bg);
          color: var(--urgent-red);
        }

        .review-badge {
          font-size: 0.8125rem;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .tag-urgent {
          background-color: var(--urgent-red-bg);
          color: var(--urgent-red);
        }

        .tag-success {
          background-color: var(--success-green-bg);
          color: var(--success-green);
        }

        .text-urgent {
          color: var(--urgent-red);
        }

        /* Action box layout */
        .action-required-box {
          background-color: var(--pending-orange-bg);
          border: 1px solid rgba(234, 88, 12, 0.15);
          padding: 12px;
          border-radius: 8px;
          color: var(--pending-orange);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .action-box-title {
          font-weight: 700;
          font-size: 0.8125rem;
        }

        .action-box-text {
          font-size: 0.8125rem;
          line-height: 1.4;
          color: var(--text-dark);
        }

        .why-classified-section {
          border-top: 1px dashed var(--border-gray);
          padding-top: 10px;
        }

        .why-toggle-btn {
          background: none;
          border: none;
          color: var(--primary-blue);
          font-size: 0.8125rem;
          font-weight: 600;
          cursor: pointer;
          padding: 0;
        }

        .why-content {
          margin-top: 8px;
          font-size: 0.8125rem;
          color: var(--text-muted);
          background-color: var(--workspace-bg);
          padding: 10px 12px;
          border-radius: 6px;
          border: 1px solid var(--border-gray);
          line-height: 1.5;
        }

        .action-required-box-none {
          font-size: 0.8125rem;
          color: var(--text-muted);
          text-align: center;
          padding: 12px;
          border: 1px dashed var(--border-gray);
          border-radius: 8px;
        }

        .deadline-box {
          background-color: var(--urgent-red-bg);
          border: 1px solid rgba(220, 38, 38, 0.15);
          padding: 12px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.8125rem;
        }

        .deadline-box-title {
          font-weight: 700;
          color: var(--urgent-red);
        }

        /* ── Detail Error Card ── */
        .detail-error-card {
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

        .detail-error-card h3 {
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--urgent-red);
        }

        .detail-error-card p {
          color: var(--text-muted);
          font-size: 0.925rem;
          margin-bottom: 8px;
        }

        /* ── Responsive Rules ── */

        /* Tablet & Mobile (Below 1024px) */
        @media (max-width: 1023px) {
          .detail-main-layout {
            grid-template-columns: 1fr; /* Stack left & right columns */
          }
        }

        /* Mobile specific (Below 768px) */
        @media (max-width: 767px) {
          .detail-header {
            flex-direction: column;
            align-items: flex-start;
          }

          .header-actions {
            width: 100%;
          }

          .header-actions .btn {
            flex: 1; /* Make buttons stretch evenly on mobile */
          }
        }
      `}</style>
    </div>
  );
}
