"use client";

export function CooPageStyles() {
  return (
    <style jsx global>{`
      .coo-overview-page {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .coo-clients-page {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .coo-client-detail-page {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .coo-operations-page {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .coo-live-monitor-page {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .coo-review-page {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .coo-page__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }

      .coo-toolbar {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .coo-date-form {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: end;
      }

      .coo-date-form label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        color: var(--text-muted);
        font-size: 0.8rem;
      }

      .coo-date-form input {
        min-width: 146px;
        padding: 10px 12px;
        border: 1px solid var(--border-gray);
        border-radius: 12px;
        background: var(--white);
        color: var(--text-dark);
      }

      .coo-search-form {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: end;
      }

      .coo-search-form label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        color: var(--text-muted);
        font-size: 0.8rem;
        min-width: min(100%, 420px);
        flex: 1 1 320px;
      }

      .coo-search-form input[type="search"] {
        padding: 11px 14px;
        border: 1px solid var(--border-gray);
        border-radius: 12px;
        background: var(--white);
        color: var(--text-dark);
      }

      .coo-action-button {
        padding: 10px 16px;
        border-radius: 12px;
        border: 1px solid var(--primary-blue);
        background: var(--primary-blue);
        color: #fff;
        font-weight: 600;
      }

      .coo-table-card {
        overflow: auto;
        border: 1px solid var(--border-gray);
        border-radius: 18px;
        background: var(--white);
        box-shadow: var(--card-shadow);
      }

      .coo-detail-list {
        display: grid;
        grid-template-columns: minmax(140px, 220px) minmax(0, 1fr);
        gap: 12px 18px;
        padding: 18px;
        border: 1px solid var(--border-gray);
        border-radius: 18px;
        background: var(--white);
        box-shadow: var(--card-shadow);
      }

      .coo-detail-list dt {
        color: var(--text-muted);
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .coo-detail-list dd {
        margin: 0;
        color: var(--text-dark);
        word-break: break-word;
      }

      .coo-table {
        width: 100%;
        border-collapse: collapse;
      }

      .coo-table th,
      .coo-table td {
        padding: 16px 14px;
        border-bottom: 1px solid var(--border-gray);
        vertical-align: top;
      }

      .coo-table th {
        text-align: left;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-muted);
        background: #fbfcff;
      }

      .coo-table tbody tr:hover {
        background: rgba(44, 118, 255, 0.03);
      }

      .coo-client-cell {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .coo-client-link {
        font-weight: 700;
        color: var(--text-dark);
        text-decoration: none;
      }

      .coo-client-note,
      .coo-update-note,
      .coo-page__subtitle,
      .coo-activity-meta,
      .coo-activity-time {
        color: var(--text-muted);
        font-size: 0.85rem;
      }

      .coo-update-cell {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .coo-highlight {
        color: var(--pending-orange);
        font-weight: 700;
      }

      .coo-mobile-grid {
        display: none;
        gap: 12px;
      }

      .coo-mobile-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px;
        border: 1px solid var(--border-gray);
        border-radius: 18px;
        background: var(--white);
        color: inherit;
        text-decoration: none;
        box-shadow: var(--card-shadow);
      }

      .coo-mobile-card__top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
      }

      .coo-mobile-card__title {
        font-weight: 700;
        color: var(--text-dark);
        word-break: break-word;
      }

      .coo-mobile-card__subtitle {
        color: var(--text-muted);
        font-size: 0.85rem;
        margin-top: 4px;
      }

      .coo-mobile-card__stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        font-size: 0.84rem;
        color: var(--text-muted);
      }

      .coo-chip-stack {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .coo-chip-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }

      .coo-mini-card {
        padding: 16px;
        border: 1px solid var(--border-gray);
        border-radius: 18px;
        background: var(--white);
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: var(--card-shadow);
      }

      .coo-mini-card__label {
        color: var(--text-muted);
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .coo-mini-card__value {
        font-size: 1.5rem;
        color: var(--text-dark);
      }

      .coo-timeline {
        display: grid;
        gap: 12px;
      }

      .coo-timeline-card {
        padding: 16px;
        border: 1px solid var(--border-gray);
        border-radius: 18px;
        background: var(--white);
        display: grid;
        gap: 10px;
        box-shadow: var(--card-shadow);
      }

      .coo-timeline-card__top {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 12px;
      }

      .coo-timeline-card__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        color: var(--text-muted);
        font-size: 0.85rem;
      }

      .coo-chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .coo-review-note {
        display: flex;
        gap: 8px;
        align-items: start;
        color: var(--text-muted);
        font-size: 0.9rem;
      }

      .coo-dual-grid {
        display: grid;
        grid-template-columns: 1.05fr 0.95fr;
        gap: 18px;
      }

      .coo-system-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
      }

      .coo-activity-list {
        display: grid;
        gap: 12px;
      }

      .coo-activity-card {
        display: grid;
        gap: 10px;
        padding: 16px;
        border: 1px solid var(--border-gray);
        border-radius: 18px;
        background: var(--white);
        box-shadow: var(--card-shadow);
      }

      .coo-activity-card__top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: start;
      }

      .coo-activity-recipient {
        font-weight: 700;
        color: var(--text-dark);
        word-break: break-word;
      }

      .coo-review-reason,
      .coo-review-action {
        color: var(--text-muted);
        font-size: 0.85rem;
      }

      .coo-review-action {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .coo-flow {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 10px;
      }

      .coo-flow__step {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 64px;
        padding: 14px;
        border: 1px solid var(--border-gray);
        border-radius: 16px;
        background: linear-gradient(180deg, #fff 0%, #f9fbff 100%);
        font-weight: 600;
        color: var(--text-dark);
      }

      .coo-flow__index {
        width: 28px;
        height: 28px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(44, 118, 255, 0.12);
        color: var(--primary-blue);
        font-size: 0.85rem;
        flex-shrink: 0;
      }

      .coo-operations-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
      }

      .coo-row-list {
        display: grid;
        gap: 12px;
      }

      .coo-row-card {
        display: grid;
        gap: 8px;
        padding: 16px;
        border: 1px solid var(--border-gray);
        border-radius: 18px;
        background: var(--white);
        box-shadow: var(--card-shadow);
      }

      .coo-row-card__top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: start;
      }

      .coo-row-card__meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        color: var(--text-muted);
        font-size: 0.85rem;
      }

      .coo-row-card__reason {
        color: var(--text-muted);
        font-size: 0.9rem;
      }

      .coo-pagination {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-top: 1px solid var(--border-gray);
        color: var(--text-muted);
        font-size: 0.9rem;
      }

      .coo-interviews-page,
      .coo-interview-detail-page {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .coo-metric-grid--operations,
      .coo-metric-grid--review,
      .coo-metric-grid--clients,
      .coo-metric-grid--client-detail {
        display: grid;
        gap: 14px;
      }

      .coo-metric-grid--operations {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .coo-metric-grid--live-monitor {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .coo-metric-grid--review {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .coo-metric-grid--clients {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .coo-metric-grid--client-detail {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      @media (max-width: 1024px) {
        .coo-chip-grid,
        .coo-metric-grid--client-detail {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .coo-metric-grid--operations,
        .coo-metric-grid--live-monitor,
        .coo-metric-grid--review,
        .coo-metric-grid--clients {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .coo-operations-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .coo-dual-grid {
          grid-template-columns: 1fr;
        }

        .coo-flow {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @media (max-width: 768px) {
        .coo-date-form {
          width: 100%;
        }

        .coo-date-form input {
          min-width: 0;
          width: 100%;
        }

        .coo-chip-grid,
        .coo-metric-grid--client-detail,
        .coo-metric-grid--operations,
        .coo-metric-grid--live-monitor,
        .coo-metric-grid--review,
        .coo-metric-grid--clients,
        .coo-operations-grid {
          grid-template-columns: 1fr;
        }

        .coo-table-card {
          display: none;
        }

        .coo-detail-list {
          grid-template-columns: 1fr;
        }

        .coo-mobile-grid {
          display: grid;
        }

        .coo-system-grid,
        .coo-flow {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
