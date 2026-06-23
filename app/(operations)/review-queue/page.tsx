"use client";

import React, { useState, useMemo } from "react";
import { mockApplications } from "@/lib/mockData";
import {
  classifyApplications,
  sortByPriority,
  REVIEW_CATEGORIES,
  ClassifiedApplication,
} from "@/lib/classify/classifyMockEmails";

export default function ReviewQueuePage() {
  // Source: derived records, review-eligible categories only, priority-sorted
  const initialQueue = useMemo(() => {
    const all = classifyApplications(mockApplications);
    const reviewable = all.filter(
      (a) =>
        a.derived.needs_human_review &&
        REVIEW_CATEGORIES.includes(a.derived.category)
    );
    return sortByPriority(reviewable);
  }, []);

  // ── States ──────────────────────────────────────────────────────────────────
  const [queueItems, setQueueItems] = useState<ClassifiedApplication[]>(initialQueue);
  const [selectedItem, setSelectedItem] = useState<ClassifiedApplication | null>(
    initialQueue[0] || null
  );
  const [activeTab, setActiveTab] = useState<string>("all");

  // ── Filter Queue Items ──────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    return queueItems.filter((item) => {
      if (activeTab === "all") return true;
      if (activeTab === "offers") return item.derived.category === "job_offer";
      if (activeTab === "interviews") return item.derived.category === "interview_invite";
      if (activeTab === "assessments") return item.derived.category === "assessment";
      if (activeTab === "replies") return item.derived.category === "recruiter_reply";
      if (activeTab === "followups") return item.derived.category === "follow_up_needed";
      if (activeTab === "unknown") return item.derived.category === "unknown" || item.status === "failed";
      return true;
    });
  }, [queueItems, activeTab]);

  // ── Resolve Handler ─────────────────────────────────────────────────────────
  const handleResolve = (itemId: string) => {
    alert(`Success! Review resolved for: "${selectedItem?.subject}". Email has been processed.`);
    
    // Filter out item
    const updated = queueItems.filter((item) => item.id !== itemId);
    setQueueItems(updated);
    
    // Select another item from the list
    if (updated.length > 0) {
      setSelectedItem(updated[0]);
    } else {
      setSelectedItem(null);
    }
  };

  const dueTodayCount = queueItems.filter(
    (item) =>
      item.derived.deadline === "2026-06-25" ||
      item.derived.deadline === "2026-06-26"
  ).length;

  return (
    <div className="queue-page-container">
      {/* Page Header */}
      <header className="page-header">
        <div>
          <h1 className="page-title">Advisor Review Queue</h1>
          <p className="page-subtitle">
            Resolve manual classification overrides, review assessment invites, and track interview proposals.
          </p>
        </div>
        <div className="due-today-badge">
          <span className="pulse-indicator" />
          <span>Due Today: <strong>{dueTodayCount}</strong></span>
        </div>
      </header>

      {/* Split Screen Queue Layout */}
      <div className="queue-split-layout">
        
        {/* Left Side: Filter Tabs & Items List */}
        <div className="queue-left-panel">
          {/* Tabs header scroll bar */}
          <div className="tabs-navigation">
            <button className={`tab-btn ${activeTab === "all" ? "active" : ""}`} onClick={() => setActiveTab("all")}>
              All ({queueItems.length})
            </button>
            <button className={`tab-btn ${activeTab === "offers" ? "active" : ""}`} onClick={() => setActiveTab("offers")}>
              Offers ({queueItems.filter((i) => i.derived.category === "job_offer").length})
            </button>
            <button className={`tab-btn ${activeTab === "interviews" ? "active" : ""}`} onClick={() => setActiveTab("interviews")}>
              Interviews ({queueItems.filter((i) => i.derived.category === "interview_invite").length})
            </button>
            <button className={`tab-btn ${activeTab === "assessments" ? "active" : ""}`} onClick={() => setActiveTab("assessments")}>
              Assessments ({queueItems.filter((i) => i.derived.category === "assessment").length})
            </button>
            <button className={`tab-btn ${activeTab === "replies" ? "active" : ""}`} onClick={() => setActiveTab("replies")}>
              Replies ({queueItems.filter((i) => i.derived.category === "recruiter_reply").length})
            </button>
            <button className={`tab-btn ${activeTab === "followups" ? "active" : ""}`} onClick={() => setActiveTab("followups")}>
              Follow-ups ({queueItems.filter((i) => i.derived.category === "follow_up_needed").length})
            </button>
            <button className={`tab-btn ${activeTab === "unknown" ? "active" : ""}`} onClick={() => setActiveTab("unknown")}>
              Failed ({queueItems.filter((i) => i.derived.category === "unknown" || i.status === "failed").length})
            </button>
          </div>

          {/* List items */}
          <div className="queue-items-list">
            {filteredItems.length === 0 ? (
              <div className="empty-queue-box">
                <span className="empty-icon">✓</span>
                <h3>Queue Clear</h3>
                <p>No items in this category require human review.</p>
              </div>
            ) : (
              filteredItems.map((item) => {
                const isSelected = selectedItem?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`queue-item-card ${isSelected ? "selected" : ""}`}
                    onClick={() => setSelectedItem(item)}
                  >
                    <div className="item-card-header">
                      <span className="client-name">{item.clientName}</span>
                      <span className="item-date">
                        {new Date(item.receivedDate).toLocaleDateString("en-IN")}
                      </span>
                    </div>
                    <div className="item-card-subject">{item.subject}</div>
                    <div className="item-card-footer">
                      <span className={`badge badge-${item.derived.category}`}>
                        {item.derived.category.replace("_", " ")}
                      </span>
                      {item.derived.deadline && (
                        <span className="card-deadline font-tabular text-urgent">
                          📅 {item.derived.deadline}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Detailed Review & Resolution Panel */}
        <div className="queue-right-panel">
          {!selectedItem ? (
            <div className="details-empty-state">
              <span className="big-icon">📥</span>
              <h3>No Item Selected</h3>
              <p>Select an item from the review queue list to check details and resolve alerts.</p>
            </div>
          ) : (
            <div className="resolution-details-card">
              <header className="resolution-card-header">
                <div>
                  <span className={`badge badge-${selectedItem.derived.category}`}>
                    {selectedItem.derived.category.replace("_", " ")}
                  </span>
                  <h2>{selectedItem.companyName || selectedItem.sender}</h2>
                  <p className="subtitle-detail">
                    Client: <strong>{selectedItem.clientName}</strong> · Advisor:{" "}
                    <strong>{selectedItem.caName}</strong>
                  </p>
                </div>
                <button className="btn btn-success" onClick={() => handleResolve(selectedItem.id)}>
                  ✓ Resolve Alert
                </button>
              </header>

              {/* Action Required Alert Box */}
              <div className="required-action-card">
                <h4>Suggested Operational Action:</h4>
                <p>{selectedItem.actionRequired || "No action recorded. Manual check recommended."}</p>
                {selectedItem.derived.deadline && (
                  <div className="action-deadline">
                    <span>Deadline: </span>
                    <strong className="text-urgent font-tabular">📅 {selectedItem.derived.deadline}</strong>
                  </div>
                )}
              </div>

              {/* Classification Info */}
              <div className="classification-box">
                <div className="classification-field">
                  <span>Confidence:</span>
                  <strong className="font-tabular">{(selectedItem.derived.confidence * 100).toFixed(0)}%</strong>
                </div>
                <div className="classification-field">
                  <span>Sync Folder:</span>
                  <strong>{selectedItem.folderName}</strong>
                </div>
                <div className="classification-field">
                  <span>Message ID:</span>
                  <strong className="font-tabular text-xs">{selectedItem.id}</strong>
                </div>
              </div>

              {/* Email Content Box */}
              <div className="email-content-preview">
                <div className="email-headers">
                  <div><strong>From:</strong> {selectedItem.sender}</div>
                  <div><strong>To:</strong> {selectedItem.mailbox}</div>
                  <div><strong>Subject:</strong> {selectedItem.subject}</div>
                </div>
                <div className="email-body">
                  <pre>{selectedItem.body}</pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .queue-page-container {
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

        .due-today-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 0.8125rem;
          font-weight: 700;
          color: var(--urgent-red);
          background-color: var(--urgent-red-bg);
          padding: 6px 16px;
          border-radius: 9999px;
          border: 1px solid rgba(220, 38, 38, 0.15);
        }

        .pulse-indicator {
          width: 6px;
          height: 6px;
          background-color: var(--urgent-red);
          border-radius: 50%;
          animation: pulse-glow 2s infinite;
        }

        @keyframes pulse-glow {
          0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.7); }
          70% { box-shadow: 0 0 0 6px rgba(220, 38, 38, 0); }
          100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
        }

        /* ── Split Layout ── */
        .queue-split-layout {
          display: grid;
          grid-template-columns: 1fr 1.2fr;
          gap: 24px;
          min-height: 520px;
        }

        .queue-left-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
          border-right: 1px solid var(--border-gray);
          padding-right: 24px;
        }

        .queue-right-panel {
          display: flex;
          flex-direction: column;
        }

        /* ── Tabs Navigation ── */
        .tabs-navigation {
          display: flex;
          align-items: center;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border-gray);
        }

        .tab-btn {
          padding: 6px 12px;
          border-radius: 6px;
          background: none;
          border: 1px solid transparent;
          color: var(--text-muted);
          font-size: 0.8125rem;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: background-color 0.2s, color 0.2s;
        }

        .tab-btn:hover {
          background-color: var(--workspace-bg);
          color: var(--text-dark);
        }

        .tab-btn.active {
          background-color: var(--navy-sidebar);
          color: #ffffff;
        }

        /* ── Queue List Items ── */
        .queue-items-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-height: 480px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .queue-item-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 8px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          cursor: pointer;
          transition: border-color 0.2s, box-shadow 0.2s;
          box-shadow: var(--card-shadow);
        }

        .queue-item-card:hover {
          border-color: var(--primary-blue);
          box-shadow: var(--card-shadow-hover);
        }

        .queue-item-card.selected {
          border-color: var(--primary-blue);
          border-left: 4px solid var(--primary-blue);
          background-color: rgba(37, 99, 235, 0.02);
        }

        .item-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.75rem;
        }

        .client-name {
          font-weight: 700;
          color: var(--text-dark);
        }

        .item-date {
          color: var(--text-muted);
        }

        .item-card-subject {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--text-dark);
          line-height: 1.4;
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        .item-card-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .card-deadline {
          font-size: 0.75rem;
          font-weight: 600;
        }

        /* ── Right Resolution Card ── */
        .resolution-details-card {
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 24px;
          box-shadow: var(--card-shadow);
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .resolution-card-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          border-bottom: 1px solid var(--border-gray);
          padding-bottom: 16px;
        }

        .resolution-card-header h2 {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text-dark);
          margin-top: 6px;
        }

        .subtitle-detail {
          font-size: 0.8125rem;
          color: var(--text-muted);
          margin-top: 4px;
        }

        .subtitle-detail strong {
          color: var(--text-dark);
        }

        /* Action Alert Box */
        .required-action-card {
          background-color: var(--pending-orange-bg);
          border: 1px solid rgba(234, 88, 12, 0.15);
          border-radius: 8px;
          padding: 16px;
          color: var(--pending-orange);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .required-action-card h4 {
          font-size: 0.8125rem;
          font-weight: 700;
        }

        .required-action-card p {
          font-size: 0.875rem;
          color: var(--text-dark);
          line-height: 1.4;
        }

        .action-deadline {
          font-size: 0.8125rem;
          margin-top: 4px;
          border-top: 1px dashed rgba(234, 88, 12, 0.2);
          padding-top: 6px;
        }

        /* Classification info */
        .classification-box {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          padding: 12px;
          border-radius: 8px;
          background-color: var(--workspace-bg);
          border: 1px solid var(--border-gray);
          font-size: 0.8125rem;
        }

        .classification-field {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .classification-field span {
          color: var(--text-muted);
        }

        /* Email Content */
        .email-content-preview {
          border: 1px solid var(--border-gray);
          border-radius: 8px;
          overflow: hidden;
        }

        .email-headers {
          padding: 16px;
          background-color: rgba(248, 250, 252, 0.5);
          border-bottom: 1px solid var(--border-gray);
          font-size: 0.8125rem;
          color: var(--text-dark);
          line-height: 1.5;
        }

        .email-body {
          padding: 16px;
          max-height: 240px;
          overflow-y: auto;
          background-color: var(--white);
        }

        .email-body pre {
          font-family: var(--font-display);
          font-size: 0.875rem;
          line-height: 1.6;
          white-space: pre-wrap;
          word-break: break-word;
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

        .btn {
          padding: 10px 20px;
          font-size: 0.875rem;
          font-weight: 600;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .btn-success {
          background-color: var(--success-green);
          color: var(--white);
        }

        .btn-success:hover {
          background-color: #15803d;
        }

        .text-urgent { color: var(--urgent-red); }
        .font-tabular { font-feature-settings: "tnum"; }

        /* Empty states */
        .empty-queue-box {
          text-align: center;
          padding: 48px 24px;
          color: var(--text-muted);
        }

        .empty-queue-box h3 {
          font-size: 1.15rem;
          color: var(--text-dark);
          margin-top: 8px;
        }

        .empty-queue-box p {
          font-size: 0.875rem;
          margin-top: 4px;
        }

        .details-empty-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          background-color: var(--white);
          border: 1px solid var(--border-gray);
          border-radius: 12px;
          padding: 48px;
          box-shadow: var(--card-shadow);
        }

        .big-icon {
          font-size: 3rem;
          margin-bottom: 12px;
        }

        .details-empty-state h3 {
          font-size: 1.25rem;
          font-weight: 700;
        }

        .details-empty-state p {
          color: var(--text-muted);
          font-size: 0.925rem;
          max-width: 280px;
          line-height: 1.5;
          margin-top: 8px;
        }

        /* ── Responsive Splits ── */
        @media (max-width: 1023px) {
          .queue-split-layout {
            grid-template-columns: 1fr; /* Stack panels */
          }

          .queue-left-panel {
            border-right: none;
            padding-right: 0;
          }
        }
      `}</style>
    </div>
  );
}
