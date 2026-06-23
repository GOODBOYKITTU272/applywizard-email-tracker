"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLinkProps {
  href: string;
  icon: string;
  label: string;
  onClick?: () => void;
}

function NavLink({ href, icon, label, onClick }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`nav-item ${isActive ? "active" : ""}`}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
    </Link>
  );
}

export default function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="ops-app-shell">
      {/* ── Desktop/Laptop Sidebar ── */}
      <aside className="ops-sidebar">
        <div className="sidebar-brand">
          <span className="brand-dot" />
          <span className="brand-text">ApplyWizard Ops</span>
        </div>

        <nav className="sidebar-nav">
          <NavLink href="/overview" icon="📊" label="Overview" />
          <NavLink href="/applications" icon="📁" label="Applications" />
          <NavLink href="/clients" icon="👥" label="Clients & Mailboxes" />
          <NavLink href="/mailboxes" icon="🔌" label="Connections" />
          <NavLink href="/review-queue" icon="📥" label="Review Queue" />
          <NavLink href="/ca-portfolio" icon="👔" label="CA Portfolio" />
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">OP</div>
            <div className="user-details">
              <div className="user-name">Operations Room</div>
              <div className="user-role">Super Admin</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Mobile Hamburger Header ── */}
      <header className="mobile-header">
        <div className="mobile-brand">
          <span className="brand-dot" />
          <span>ApplyWizard Ops</span>
        </div>
        <button
          className="hamburger-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle Navigation Menu"
        >
          {mobileMenuOpen ? "✕" : "☰"}
        </button>
      </header>

      {/* ── Mobile Drawer Overlay ── */}
      {mobileMenuOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setMobileMenuOpen(false)}>
          <div className="mobile-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <span className="brand-dot" />
              <span>ApplyWizard Ops</span>
              <button className="close-btn" onClick={() => setMobileMenuOpen(false)}>
                ✕
              </button>
            </div>
            <nav className="drawer-nav">
              <NavLink href="/overview" icon="📊" label="Overview" onClick={() => setMobileMenuOpen(false)} />
              <NavLink href="/applications" icon="📁" label="Applications" onClick={() => setMobileMenuOpen(false)} />
              <NavLink href="/clients" icon="👥" label="Clients & Mailboxes" onClick={() => setMobileMenuOpen(false)} />
              <NavLink href="/mailboxes" icon="🔌" label="Connections" onClick={() => setMobileMenuOpen(false)} />
              <NavLink href="/review-queue" icon="📥" label="Review Queue" onClick={() => setMobileMenuOpen(false)} />
              <NavLink href="/ca-portfolio" icon="👔" label="CA Portfolio" onClick={() => setMobileMenuOpen(false)} />
            </nav>
          </div>
        </div>
      )}

      {/* ── Main Workspace ── */}
      <div className="ops-workspace">
        <header className="workspace-header">
          <div className="header-breadcrumbs">
            <span>Operations Console</span>
            <span className="separator">/</span>
            <span className="active-path">Dashboard</span>
          </div>
          <div className="header-actions">
            <span className="live-status">
              <span className="pulse-indicator" />
              Live Feed
            </span>
          </div>
        </header>

        <div className="workspace-content">{children}</div>
      </div>

      {/* ── Mobile Bottom Navigation Bar ── */}
      <div className="mobile-bottom-nav">
        <Link href="/overview" className="bottom-nav-item">
          <span className="nav-icon">📊</span>
          <span className="nav-text">Overview</span>
        </Link>
        <Link href="/applications" className="bottom-nav-item">
          <span className="nav-icon">📁</span>
          <span className="nav-text">Apps</span>
        </Link>
        <Link href="/review-queue" className="bottom-nav-item">
          <span className="nav-icon">📥</span>
          <span className="nav-text">Queue</span>
        </Link>
        <Link href="/clients" className="bottom-nav-item">
          <span className="nav-icon">👥</span>
          <span className="nav-text">Clients</span>
        </Link>
      </div>

      <style jsx global>{`
        /* ── Design Tokens & Base Resets ── */
        :root {
          --navy-sidebar: #0f172a;
          --navy-sidebar-hover: #1e293b;
          --workspace-bg: #f8fafc;
          --white: #ffffff;
          --primary-blue: #2563eb;
          --primary-blue-hover: #1d4ed8;
          --success-green: #16a34a;
          --success-green-bg: #dcfce7;
          --pending-orange: #ea580c;
          --pending-orange-bg: #ffedd5;
          --urgent-red: #dc2626;
          --urgent-red-bg: #fee2e2;
          --border-gray: #e2e8f0;
          --text-dark: #0f172a;
          --text-muted: #64748b;
          --text-light: #94a3b8;
          --sidebar-text-active: #ffffff;
          --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
          --card-shadow-hover: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
          --font-display: 'Inter', system-ui, -apple-system, sans-serif;
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: var(--font-display);
          background-color: var(--workspace-bg);
          color: var(--text-dark);
          -webkit-font-smoothing: antialiased;
        }

        /* ── Main Layout Shell ── */
        .ops-app-shell {
          display: flex;
          min-height: 100vh;
          position: relative;
        }

        /* ── Sidebar (Desktop / Laptop) ── */
        .ops-sidebar {
          width: 260px;
          background-color: var(--navy-sidebar);
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          flex-direction: column;
          position: fixed;
          top: 0;
          bottom: 0;
          left: 0;
          z-index: 100;
          transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .sidebar-brand {
          height: 64px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 24px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          color: #ffffff;
          font-weight: 700;
          font-size: 1.15rem;
          white-space: nowrap;
          overflow: hidden;
        }

        .brand-dot {
          width: 8px;
          height: 8px;
          background-color: var(--primary-blue);
          border-radius: 50%;
          flex-shrink: 0;
          box-shadow: 0 0 8px var(--primary-blue);
        }

        .sidebar-nav {
          flex: 1;
          padding: 24px 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          color: var(--text-light);
          text-decoration: none;
          border-radius: 8px;
          font-weight: 500;
          font-size: 0.925rem;
          transition: background-color 0.2s, color 0.2s;
          white-space: nowrap;
        }

        .nav-item:hover {
          background-color: var(--navy-sidebar-hover);
          color: #ffffff;
        }

        .nav-item.active {
          background-color: var(--primary-blue);
          color: var(--sidebar-text-active);
        }

        .nav-icon {
          font-size: 1.15rem;
          flex-shrink: 0;
        }

        .sidebar-footer {
          padding: 20px 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          overflow: hidden;
        }

        .user-profile {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .user-avatar {
          width: 36px;
          height: 36px;
          background-color: var(--primary-blue);
          color: #ffffff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 0.875rem;
          flex-shrink: 0;
        }

        .user-details {
          display: flex;
          flex-direction: column;
          gap: 2px;
          overflow: hidden;
        }

        .user-name {
          color: #ffffff;
          font-weight: 600;
          font-size: 0.875rem;
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        .user-role {
          color: var(--text-light);
          font-size: 0.75rem;
        }

        /* ── Main Workspace Area ── */
        .ops-workspace {
          flex: 1;
          margin-left: 260px;
          background-color: var(--workspace-bg);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          transition: margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .workspace-header {
          height: 64px;
          background-color: var(--white);
          border-bottom: 1px solid var(--border-gray);
          padding: 0 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          position: sticky;
          top: 0;
          z-index: 90;
        }

        .header-breadcrumbs {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.875rem;
          color: var(--text-muted);
        }

        .header-breadcrumbs .separator {
          color: var(--text-light);
        }

        .header-breadcrumbs .active-path {
          color: var(--text-dark);
          font-weight: 600;
        }

        .header-actions {
          display: flex;
          align-items: center;
        }

        .live-status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--success-green);
          background-color: var(--success-green-bg);
          padding: 4px 12px;
          border-radius: 9999px;
        }

        .pulse-indicator {
          width: 6px;
          height: 6px;
          background-color: var(--success-green);
          border-radius: 50%;
          animation: pulse-glow 2s infinite;
        }

        @keyframes pulse-glow {
          0% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.7); }
          70% { box-shadow: 0 0 0 6px rgba(22, 163, 74, 0); }
          100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
        }

        .workspace-content {
          padding: 32px;
          flex: 1;
        }

        /* ── Mobile Layout Specific Components ── */
        .mobile-header,
        .mobile-bottom-nav,
        .mobile-drawer-overlay {
          display: none;
        }

        /* ── Responsive Rules (Media Queries) ── */

        /* Laptop Breakpoint (1024px - 1439px) */
        @media (min-width: 1024px) and (max-width: 1439px) {
          .workspace-content {
            padding: 24px;
          }
        }

        /* Tablet Breakpoint (768px - 1023px) */
        @media (min-width: 768px) and (max-width: 1023px) {
          .ops-sidebar {
            width: 72px;
          }

          .sidebar-brand .brand-text,
          .nav-item .nav-label,
          .user-profile .user-details {
            display: none;
          }

          .sidebar-brand {
            padding: 0;
            justify-content: center;
          }

          .sidebar-nav {
            padding: 24px 8px;
            align-items: center;
          }

          .nav-item {
            justify-content: center;
            width: 48px;
            height: 48px;
            padding: 0;
          }

          .sidebar-footer {
            display: flex;
            justify-content: center;
            padding: 16px 0;
          }

          .ops-workspace {
            margin-left: 72px;
          }

          .workspace-header {
            padding: 0 24px;
          }

          .workspace-content {
            padding: 24px;
          }
        }

        /* Mobile Breakpoint (Below 768px) */
        @media (max-width: 767px) {
          .ops-sidebar {
            display: none;
          }

          .ops-workspace {
            margin-left: 0;
            padding-bottom: 72px; /* Margin to prevent bottom-nav overlaps */
          }

          .workspace-header {
            display: none; /* Breadcrumbs hidden on mobile */
          }

          .workspace-content {
            padding: 16px;
          }

          /* Show Mobile Top Bar */
          .mobile-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            height: 56px;
            background-color: var(--navy-sidebar);
            color: #ffffff;
            padding: 0 16px;
            position: sticky;
            top: 0;
            z-index: 110;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          }

          .mobile-brand {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 700;
            font-size: 1rem;
          }

          .hamburger-btn {
            background: none;
            border: none;
            color: #ffffff;
            font-size: 1.5rem;
            cursor: pointer;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          /* Show Mobile Bottom Navigation */
          .mobile-bottom-nav {
            display: flex;
            justify-content: space-around;
            align-items: center;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: 64px;
            background-color: var(--white);
            border-top: 1px solid var(--border-gray);
            z-index: 100;
            box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);
          }

          .bottom-nav-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 4px;
            text-decoration: none;
            color: var(--text-muted);
            font-size: 0.6875rem;
            font-weight: 600;
            width: 25%;
            height: 100%;
          }

          .bottom-nav-item .nav-icon {
            font-size: 1.25rem;
          }

          /* Mobile Navigation Drawer Overlay */
          .mobile-drawer-overlay {
            display: block;
            position: fixed;
            inset: 0;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 120;
            backdrop-filter: blur(4px);
          }

          .mobile-drawer {
            position: absolute;
            top: 0;
            bottom: 0;
            left: 0;
            width: 280px;
            background-color: var(--navy-sidebar);
            display: flex;
            flex-direction: column;
            animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }

          @keyframes slideIn {
            from { transform: translateX(-100%); }
            to { transform: translateX(0); }
          }

          .drawer-header {
            height: 56px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            align-items: center;
            padding: 0 16px;
            gap: 8px;
            color: #ffffff;
            font-weight: 700;
            justify-content: space-between;
          }

          .drawer-header .close-btn {
            background: none;
            border: none;
            color: var(--text-light);
            font-size: 1.25rem;
            cursor: pointer;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .drawer-nav {
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
        }
      `}</style>
    </div>
  );
}
