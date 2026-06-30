import Link from "next/link";

export default function Home() {
  return (
    <main className="hero-wrapper">
      {/* Animated ambient orbs */}
      <div className="orb orb-1" aria-hidden="true" />
      <div className="orb orb-2" aria-hidden="true" />
      <div className="orb orb-3" aria-hidden="true" />

      {/* Grid noise overlay */}
      <div className="grid-overlay" aria-hidden="true" />

      {/* Content */}
      <div className="hero-content">
        {/* Badge */}
        <div className="badge">
          <span className="badge-dot" />
          <span>Project Setup Complete</span>
        </div>

        {/* Headline */}
        <h1 className="hero-title">
          <span className="hero-title-top">ApplyWizard</span>
          <span className="hero-title-bottom">Email Tracker</span>
        </h1>

        {/* Sub-headline */}
        <p className="hero-subtitle">
          A Vercel-ready Next.js app that will connect to{" "}
          <strong>Zoho Mail</strong>, classify emails with{" "}
          <strong>AI</strong>, and store results in{" "}
          <strong>Supabase</strong>.
        </p>

        {/* Status cards */}
        <div className="status-grid">
          <StatusCard
            icon="✅"
            label="Next.js 16"
            detail="App Router · TypeScript"
            done
          />
          <StatusCard
            icon="🔐"
            label="Zoho OAuth"
            detail="Coming in Phase 2"
          />
          <StatusCard
            icon="🤖"
            label="AI Classification"
            detail="Coming in Phase 3"
          />
          <StatusCard
            icon="🗄️"
            label="Supabase Storage"
            detail="Coming in Phase 4"
          />
        </div>

        {/* CTA */}
        <div className="hero-cta">
          <span className="cta-label">Run the dev server to get started:</span>
          <code className="cta-code">npm run dev</code>
          <Link href="/overview" className="overview-link">
            Open COO Overview
          </Link>
        </div>
      </div>

      <style>{`
        /* ── Layout ── */
        .hero-wrapper {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2rem 1.25rem;
          overflow: hidden;
          background: #0a0c10;
        }

        /* ── Ambient orbs ── */
        .orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(90px);
          opacity: 0.45;
          pointer-events: none;
          animation: orbFloat 8s ease-in-out infinite alternate;
        }
        .orb-1 {
          width: 520px;
          height: 520px;
          background: radial-gradient(circle, #6c63ff 0%, transparent 70%);
          top: -120px;
          left: -160px;
          animation-delay: 0s;
        }
        .orb-2 {
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, #a78bfa 0%, transparent 70%);
          bottom: -100px;
          right: -100px;
          animation-delay: -3s;
        }
        .orb-3 {
          width: 300px;
          height: 300px;
          background: radial-gradient(circle, #818cf8 0%, transparent 70%);
          top: 50%;
          left: 60%;
          transform: translate(-50%, -50%);
          animation-delay: -6s;
          opacity: 0.25;
        }

        @keyframes orbFloat {
          0%   { transform: translate(0, 0) scale(1); }
          100% { transform: translate(20px, 30px) scale(1.06); }
        }
        .orb-3 {
          animation-name: orbFloat3;
        }
        @keyframes orbFloat3 {
          0%   { transform: translate(-50%, -50%) scale(1); }
          100% { transform: translate(calc(-50% + 20px), calc(-50% + 30px)) scale(1.06); }
        }

        /* ── Grid overlay ── */
        .grid-overlay {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
          background-size: 52px 52px;
          pointer-events: none;
          mask-image: radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 100%);
        }

        /* ── Hero content ── */
        .hero-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 2rem;
          max-width: 760px;
          animation: fadeUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(28px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Badge ── */
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 16px;
          border-radius: 9999px;
          border: 1px solid rgba(108, 99, 255, 0.4);
          background: rgba(108, 99, 255, 0.1);
          font-size: 0.8rem;
          font-weight: 500;
          color: #a78bfa;
          letter-spacing: 0.02em;
          font-family: 'Inter', sans-serif;
        }
        .badge-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #6ee7b7;
          box-shadow: 0 0 8px #6ee7b7;
          animation: pulse 2s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.6; transform: scale(1.3); }
        }

        /* ── Title ── */
        .hero-title {
          font-family: 'Space Grotesk', sans-serif;
          display: flex;
          flex-direction: column;
          line-height: 1.05;
          letter-spacing: -0.03em;
        }
        .hero-title-top {
          font-size: clamp(3rem, 8vw, 5.5rem);
          font-weight: 800;
          background: linear-gradient(135deg, #f0f2f8 0%, #c7c4ff 60%, #a78bfa 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .hero-title-bottom {
          font-size: clamp(2rem, 5.5vw, 3.8rem);
          font-weight: 500;
          color: #9098b0;
        }

        /* ── Subtitle ── */
        .hero-subtitle {
          font-size: clamp(1rem, 2.2vw, 1.15rem);
          color: #9098b0;
          max-width: 560px;
          line-height: 1.7;
          font-family: 'Inter', sans-serif;
        }
        .hero-subtitle strong {
          color: #c7c4ff;
          font-weight: 600;
        }

        /* ── Status Grid ── */
        .status-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
          width: 100%;
          max-width: 560px;
        }
        @media (max-width: 480px) {
          .status-grid {
            grid-template-columns: 1fr;
          }
        }

        .status-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(8px);
          text-align: left;
          transition: border-color 0.25s ease, background 0.25s ease, transform 0.25s ease;
          cursor: default;
        }
        .status-card:hover {
          border-color: rgba(108, 99, 255, 0.35);
          background: rgba(108, 99, 255, 0.06);
          transform: translateY(-2px);
        }
        .status-card.done {
          border-color: rgba(110, 231, 183, 0.25);
          background: rgba(110, 231, 183, 0.04);
        }
        .status-card.done:hover {
          border-color: rgba(110, 231, 183, 0.45);
          background: rgba(110, 231, 183, 0.08);
        }
        .status-icon {
          font-size: 1.4rem;
          flex-shrink: 0;
        }
        .status-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .status-label {
          font-size: 0.9rem;
          font-weight: 600;
          color: #f0f2f8;
          font-family: 'Space Grotesk', sans-serif;
        }
        .status-detail {
          font-size: 0.75rem;
          color: #555d75;
          font-family: 'Inter', sans-serif;
        }
        .status-card.done .status-detail {
          color: #6ee7b7;
        }

        /* ── CTA ── */
        .hero-cta {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .cta-label {
          font-size: 0.8rem;
          color: #555d75;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-family: 'Inter', sans-serif;
        }
        .cta-code {
          display: inline-block;
          padding: 10px 28px;
          border-radius: 9999px;
          border: 1px solid rgba(108, 99, 255, 0.5);
          background: rgba(108, 99, 255, 0.12);
          color: #c7c4ff;
          font-family: 'Fira Code', 'Cascadia Code', 'Courier New', monospace;
          font-size: 1rem;
          font-weight: 500;
          letter-spacing: 0.04em;
          box-shadow: 0 0 20px rgba(108, 99, 255, 0.2);
          transition: box-shadow 0.25s ease, background 0.25s ease;
          user-select: all;
        }
        .cta-code:hover {
          background: rgba(108, 99, 255, 0.2);
          box-shadow: 0 0 36px rgba(108, 99, 255, 0.4);
        }
        .overview-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-top: 4px;
          padding: 10px 18px;
          border-radius: 9999px;
          border: 1px solid rgba(110, 231, 183, 0.24);
          background: rgba(110, 231, 183, 0.08);
          color: #d1fae5;
          font-family: 'Inter', sans-serif;
          font-size: 0.9rem;
          font-weight: 600;
          transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
        }
        .overview-link:hover {
          background: rgba(110, 231, 183, 0.14);
          border-color: rgba(110, 231, 183, 0.4);
          transform: translateY(-1px);
        }
      `}</style>
    </main>
  );
}

/* ── StatusCard sub-component ── */
function StatusCard({
  icon,
  label,
  detail,
  done = false,
}: {
  icon: string;
  label: string;
  detail: string;
  done?: boolean;
}) {
  return (
    <div className={`status-card${done ? " done" : ""}`}>
      <span className="status-icon">{icon}</span>
      <div className="status-info">
        <span className="status-label">{label}</span>
        <span className="status-detail">{detail}</span>
      </div>
    </div>
  );
}
