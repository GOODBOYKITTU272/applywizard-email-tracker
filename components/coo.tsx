import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "critical" | "review" | "offer" | "interview" | "assessment";

export function CooBadge({
  label,
  tone = "neutral",
  compact = false,
}: {
  label: string;
  tone?: Tone;
  compact?: boolean;
}) {
  return <span className={`coo-badge coo-badge--${tone} ${compact ? "is-compact" : ""}`.trim()}>{label}</span>;
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: number | string;
  hint: string;
  tone?: Tone;
  icon?: ReactNode;
}) {
  return (
    <article className={`coo-metric coo-metric--${tone}`}>
      <div className="coo-metric__head">
        <span className="coo-metric__label">{label}</span>
        {icon ? <span className="coo-metric__icon">{icon}</span> : null}
      </div>
      <strong className="coo-metric__value">{value}</strong>
      <p className="coo-metric__hint">{hint}</p>
    </article>
  );
}

export function SectionBlock({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="coo-section">
      <div className="coo-section__head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div className="coo-section__action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="coo-empty">
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div className="coo-empty__action">{action}</div> : null}
    </div>
  );
}

