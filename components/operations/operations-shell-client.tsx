"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Noto_Sans, Inter, Space_Grotesk } from "next/font/google";
import {
  IconOverview,
  IconClients,
  IconMailboxes,
  IconReviewQueue,
  IconMail,
  IconMenu,
  IconClose,
} from "@/components/icons";
import { CooPageStyles } from "@/components/coo-page-styles";

const noto = Noto_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-noto-sans",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-inter",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
});

interface NavLinkProps {
  href: string;
  icon: React.ReactNode;
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
      aria-label={label}
      className={`nav-item ${isActive ? "active" : ""}`}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
    </Link>
  );
}

function roleLabel(role: "admin_ceo" | "manager_ops" | "ca"): string {
  if (role === "admin_ceo") return "Admin";
  if (role === "manager_ops") return "Manager";
  return "CA";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function OperationsShellClient({
  children,
  userName,
  userRole,
}: {
  children: React.ReactNode;
  userName: string;
  userRole: "admin_ceo" | "manager_ops" | "ca";
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const logoutBusyRef = useRef(false);
  const pathname = usePathname();
  const activeLabel =
    pathname === "/overview"
      ? "Overview"
      : pathname === "/live-monitor" || pathname.startsWith("/live-monitor/")
        ? "Live Monitor"
      : pathname === "/clients"
        ? "Clients"
      : pathname === "/operations" || pathname.startsWith("/operations/")
          ? "Operations"
          : pathname === "/review-queue"
            ? "Review Queue"
            : "COO";

  async function handleLogout() {
    if (logoutBusyRef.current) return;
    logoutBusyRef.current = true;

    try {
      await fetch("/api/dashboard/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // Logout navigation must proceed even if the idempotent endpoint is unavailable.
    } finally {
      window.location.assign("/dashboard/login");
    }
  }

  return (
    <div
      className={`ops-app-shell ${noto.variable} ${inter.variable} ${spaceGrotesk.variable}`}
    >
      {/* ── Desktop/Laptop Sidebar ── */}
      <aside className="ops-sidebar">
        <div className="sidebar-brand">
          <div className="brand-lockup">
            <span className="brand-title">ApplyWizz</span>
            <span className="brand-subtitle">Email Operations</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          <NavLink
            href="/overview"
            icon={<IconOverview size={20} />}
            label="Overview"
          />
          <NavLink
            href="/live-monitor/email-arrival"
            icon={<IconMail size={20} />}
            label="Live Monitor"
          />
          <NavLink
            href="/clients"
            icon={<IconClients size={20} />}
            label="Clients"
          />
          <NavLink href="/operations" icon={<IconMailboxes size={20} />} label="Operations" />
          <NavLink
            href="/review-queue"
            icon={<IconReviewQueue size={20} />}
            label="Review Queue"
          />
        </nav>

        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">{initials(userName)}</div>
            <div className="user-details">
              <div className="user-name">{userName}</div>
              <div className="user-role">{roleLabel(userRole)}</div>
            </div>
          </div>
          <button
            type="button"
            className="logout-button"
            data-testid="dashboard-logout-button"
            onClick={handleLogout}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Mobile Hamburger Header ── */}
      <header className="mobile-header">
        <div className="mobile-brand">
          <div className="brand-lockup">
            <span className="brand-title">ApplyWizz</span>
            <span className="brand-subtitle">Email Operations</span>
          </div>
        </div>
        <button
          type="button"
          className="hamburger-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle Navigation Menu"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-navigation-drawer"
        >
          {mobileMenuOpen ? <IconClose size={24} /> : <IconMenu size={24} />}
        </button>
      </header>

      {/* ── Mobile Drawer Overlay ── */}
      {mobileMenuOpen && (
        <div
          className="mobile-drawer-overlay"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            id="mobile-navigation-drawer"
            className="mobile-drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <div className="brand-lockup">
                <span className="brand-title">ApplyWizz</span>
                <span className="brand-subtitle">Email Operations</span>
              </div>
              <button
                type="button"
                className="close-btn"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
              >
                <IconClose size={24} />
              </button>
            </div>
            <nav className="drawer-nav">
              <NavLink
                href="/overview"
                icon={<IconOverview size={20} />}
                label="Overview"
                onClick={() => setMobileMenuOpen(false)}
              />
              <NavLink
                href="/live-monitor/email-arrival"
                icon={<IconMail size={20} />}
                label="Live Monitor"
                onClick={() => setMobileMenuOpen(false)}
              />
              <NavLink
                href="/clients"
                icon={<IconClients size={20} />}
                label="Clients"
                onClick={() => setMobileMenuOpen(false)}
              />
              <NavLink href="/operations" icon={<IconMailboxes size={20} />} label="Operations" onClick={() => setMobileMenuOpen(false)} />
              <NavLink
                href="/review-queue"
                icon={<IconReviewQueue size={20} />}
                label="Review Queue"
                onClick={() => setMobileMenuOpen(false)}
              />
              <button
                type="button"
                className="drawer-logout-button"
                data-testid="dashboard-mobile-logout-button"
                onClick={handleLogout}
              >
                Sign out
              </button>
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
            <span className="active-path">{activeLabel}</span>
          </div>
          <div className="header-actions">
            <span className="live-status">
              <span className="pulse-indicator" />
              Live Feed
            </span>
          </div>
        </header>

        <div className="workspace-content">
          <CooPageStyles />
          {children}
        </div>
      </div>

      {/* ── Mobile Bottom Navigation Bar ── */}
      <div className="mobile-bottom-nav">
        <Link href="/overview" className="bottom-nav-item">
          <span className="nav-icon">
            <IconOverview size={20} />
          </span>
          <span className="nav-text">Overview</span>
        </Link>
        <Link href="/clients" className="bottom-nav-item">
          <span className="nav-icon">
            <IconClients size={20} />
          </span>
          <span className="nav-text">Clients</span>
        </Link>
        <Link href="/operations" className="bottom-nav-item">
          <span className="nav-icon">
            <IconMailboxes size={20} />
          </span>
          <span className="nav-text">Operations</span>
        </Link>
        <Link href="/review-queue" className="bottom-nav-item">
          <span className="nav-icon">
            <IconReviewQueue size={20} />
          </span>
          <span className="nav-text">Review</span>
        </Link>
        <button
          type="button"
          className="bottom-nav-item bottom-nav-btn"
          data-testid="dashboard-bottom-logout-button"
          onClick={handleLogout}
        >
          <span className="nav-icon">↪</span>
          <span className="nav-text">Logout</span>
        </button>
      </div>

      <style jsx global>{`
        /* ── Design Tokens & Base Resets ── */
        :root {
          --aw-navy: #0B1D33;
          --aw-blue: #2C76FF;
          --aw-green: #29FE29;
          --aw-coral: #FF5C5C;
          --aw-gray: #F5F5F5;
          --aw-text: #1E1E1E;
          --aw-deep-gray: #1A1A1A;
          --aw-success-text: #15803D;

          --font-display: var(--font-noto-sans), system-ui, -apple-system, sans-serif;
          --font-btn-label: var(--font-inter), system-ui, sans-serif;
          --font-brand: var(--font-space-grotesk), system-ui, sans-serif;

          --navy-sidebar: var(--aw-navy);
          --navy-sidebar-hover: #172b4d;
          --workspace-bg: var(--aw-gray);
          --white: #ffffff;
          --primary-blue: var(--aw-blue);
          --primary-blue-hover: #1a54c7;

          /* Green Accessibility Rules */
          --success-green-fill: var(--aw-green);
          --success-green-text: var(--aw-success-text);
          --success-green-bg: rgba(41, 254, 41, 0.15); /* Light translucent fill */

          --pending-orange: #ea580c;
          --pending-orange-bg: #ffedd5;
          --urgent-red: var(--aw-coral);
          --urgent-red-bg: #fee2e2;
          --border-gray: #e2e8f0;
          --text-dark: var(--aw-text);
          --text-muted: #64748b;
          --text-light: #94a3b8;
          --sidebar-text-active: #ffffff;
          --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.05),
            0 1px 2px rgba(0, 0, 0, 0.03);
          --card-shadow-hover: 0 4px 6px -1px rgba(0, 0, 0, 0.05),
            0 2px 4px -1px rgba(0, 0, 0, 0.03);
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body,
        h1,
        h2,
        h3,
        h4,
        h5,
        h6 {
          font-family: ${noto.style.fontFamily}, system-ui, -apple-system, sans-serif;
        }

        body {
          background-color: var(--workspace-bg);
          color: var(--text-dark);
          -webkit-font-smoothing: antialiased;
        }

        /* Set proper typography for buttons and labels */
        button,
        .btn,
        .nav-item,
        .bottom-nav-item,
        .badge,
        .caption,
        .small-label {
          font-family: var(--font-btn-label);
        }

        /* ── Main Layout Shell ── */
        .ops-app-shell {
          display: flex;
          width: 100%;
          max-width: 100%;
          min-height: 100vh;
          position: relative;
          overflow-x: hidden;
          font-family: ${noto.style.fontFamily}, system-ui, -apple-system, sans-serif;
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
          padding: 0 24px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          color: #ffffff;
          white-space: nowrap;
          overflow: hidden;
        }

        .brand-lockup {
          display: flex;
          min-width: 0;
          flex-direction: column;
          font-family: var(--font-brand);
          line-height: 1.15;
        }

        .brand-title {
          font-size: 1.2rem;
          font-weight: 700;
          letter-spacing: -0.02em;
        }

        .brand-subtitle {
          color: var(--text-light);
          font-size: 0.6875rem;
          font-weight: 500;
          letter-spacing: 0.01em;
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
          display: inline-flex;
          align-items: center;
          justify-content: center;
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

        .logout-button,
        .drawer-logout-button {
          width: 100%;
          margin-top: 12px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.06);
          color: var(--text-light);
          cursor: pointer;
          font-weight: 700;
          padding: 10px 12px;
          text-align: center;
        }

        .logout-button:hover,
        .drawer-logout-button:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
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
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
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
          color: var(--success-green-text);
          background-color: var(--success-green-bg);
          padding: 4px 12px;
          border-radius: 9999px;
        }

        .pulse-indicator {
          width: 6px;
          height: 6px;
          background-color: var(--success-green-text);
          border-radius: 50%;
          animation: pulse-glow 2s infinite;
        }

        @keyframes pulse-glow {
          0% {
            box-shadow: 0 0 0 0 rgba(21, 128, 61, 0.7);
          }
          70% {
            box-shadow: 0 0 0 6px rgba(21, 128, 61, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(21, 128, 61, 0);
          }
        }

        .workspace-content {
          padding: 32px;
          flex: 1;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
        }

        /* ── Mobile Layout Specific Components ── */
        .mobile-header,
        .mobile-bottom-nav,
        .mobile-drawer-overlay {
          display: none;
        }

        /* ── COO Shared Surfaces ── */
        .coo-page {
          display: flex;
          flex-direction: column;
          gap: 20px;
          color: var(--text-dark);
        }

        .coo-page__header {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: start;
          flex-wrap: wrap;
        }

        .coo-page__eyebrow {
          display: inline-flex;
          margin-bottom: 8px;
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--text-muted);
          font-weight: 700;
        }

        .coo-page__title {
          font-family: var(--font-brand);
          font-size: clamp(1.8rem, 2vw, 2.5rem);
          line-height: 1.1;
          color: var(--text-dark);
        }

        .coo-page__subtitle {
          margin-top: 8px;
          color: var(--text-muted);
          max-width: 62ch;
        }

        .coo-page__meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: start;
          justify-content: flex-end;
        }

        .coo-toolbar {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 14px;
          border: 1px solid var(--border-gray);
          border-radius: 18px;
          background: var(--white);
          box-shadow: var(--card-shadow);
        }

        .coo-toolbar__group {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .coo-filter-link,
        .coo-inline-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          text-decoration: none;
          font-weight: 600;
          transition: background-color 0.2s, color 0.2s, border-color 0.2s;
        }

        .coo-filter-link {
          padding: 9px 14px;
          border: 1px solid var(--border-gray);
          background: #fff;
          color: var(--text-muted);
        }

        .coo-filter-link.active {
          background: rgba(44, 118, 255, 0.12);
          border-color: rgba(44, 118, 255, 0.3);
          color: var(--primary-blue);
        }

        .coo-inline-link {
          color: var(--primary-blue);
          text-decoration: none;
          font-weight: 700;
        }

        .coo-action-button {
          cursor: pointer;
        }

        .coo-section {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .coo-section__head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: start;
          flex-wrap: wrap;
        }

        .coo-section__head h2 {
          font-family: var(--font-brand);
          font-size: 1.35rem;
          color: var(--text-dark);
        }

        .coo-section__head p {
          margin-top: 6px;
          color: var(--text-muted);
        }

        .coo-section__action {
          display: flex;
          align-items: center;
        }

        .coo-metric-grid {
          display: grid;
          gap: 14px;
        }

        .coo-metric {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 18px;
          border: 1px solid var(--border-gray);
          border-radius: 18px;
          background: var(--white);
          box-shadow: var(--card-shadow);
          min-height: 152px;
        }

        .coo-metric--clickable {
          color: inherit;
          text-decoration: none;
          transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
        }

        .coo-metric--clickable:hover,
        .coo-metric--clickable:focus-visible {
          transform: translateY(-1px);
          box-shadow: 0 18px 32px rgba(11, 29, 51, 0.12);
          border-color: rgba(44, 118, 255, 0.35);
          outline: none;
        }

        .coo-metric__head {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: start;
        }

        .coo-metric__label {
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-muted);
          font-weight: 700;
        }

        .coo-metric__icon {
          color: var(--primary-blue);
        }

        .coo-metric__value {
          font-family: var(--font-brand);
          font-size: clamp(1.8rem, 2.5vw, 2.6rem);
          line-height: 1;
          color: var(--text-dark);
        }

        .coo-metric__hint {
          color: var(--text-muted);
          font-size: 0.88rem;
          margin-top: auto;
        }

        .coo-metric--offer {
          border-color: rgba(41, 254, 41, 0.28);
          background: linear-gradient(180deg, rgba(41, 254, 41, 0.08), #fff);
        }

        .coo-metric--interview {
          border-color: rgba(44, 118, 255, 0.28);
          background: linear-gradient(180deg, rgba(44, 118, 255, 0.08), #fff);
        }

        .coo-metric--assessment {
          border-color: rgba(251, 146, 60, 0.28);
          background: linear-gradient(180deg, rgba(251, 146, 60, 0.08), #fff);
        }

        .coo-metric--review {
          border-color: rgba(248, 113, 113, 0.28);
          background: linear-gradient(180deg, rgba(248, 113, 113, 0.08), #fff);
        }

        .coo-metric--warning {
          border-color: rgba(234, 88, 12, 0.22);
        }

        .coo-metric--critical {
          border-color: rgba(248, 113, 113, 0.32);
        }

        .coo-metric--success {
          border-color: rgba(34, 197, 94, 0.24);
        }

        .coo-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 700;
          line-height: 1;
          border: 1px solid transparent;
          white-space: nowrap;
        }

        .coo-badge.is-compact {
          padding: 4px 8px;
        }

        .coo-badge--neutral {
          background: rgba(100, 116, 139, 0.08);
          color: #334155;
          border-color: rgba(100, 116, 139, 0.16);
        }

        .coo-badge--success {
          background: rgba(34, 197, 94, 0.12);
          color: #15803d;
          border-color: rgba(34, 197, 94, 0.18);
        }

        .coo-badge--warning {
          background: rgba(234, 88, 12, 0.12);
          color: #b45309;
          border-color: rgba(234, 88, 12, 0.18);
        }

        .coo-badge--critical {
          background: rgba(239, 68, 68, 0.12);
          color: #b91c1c;
          border-color: rgba(239, 68, 68, 0.18);
        }

        .coo-badge--review {
          background: rgba(168, 85, 247, 0.12);
          color: #7c3aed;
          border-color: rgba(168, 85, 247, 0.18);
        }

        .coo-badge--offer {
          background: rgba(16, 185, 129, 0.12);
          color: #047857;
          border-color: rgba(16, 185, 129, 0.18);
        }

        .coo-badge--interview {
          background: rgba(44, 118, 255, 0.12);
          color: #1d4ed8;
          border-color: rgba(44, 118, 255, 0.18);
        }

        .coo-badge--assessment {
          background: rgba(251, 146, 60, 0.12);
          color: #c2410c;
          border-color: rgba(251, 146, 60, 0.18);
        }

        .coo-empty {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 18px;
          border: 1px dashed rgba(100, 116, 139, 0.25);
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.65);
        }

        .coo-empty strong {
          font-weight: 700;
          color: var(--text-dark);
        }

        .coo-empty p {
          color: var(--text-muted);
        }

        .coo-metric-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .coo-table-card {
          overflow: auto;
          border: 1px solid var(--border-gray);
          border-radius: 18px;
          background: var(--white);
          box-shadow: var(--card-shadow);
        }

        .coo-table {
          width: 100%;
          border-collapse: collapse;
          color: var(--text-dark);
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

        .coo-mobile-grid {
          display: none;
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
          align-items: start;
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

        .coo-chip-row,
        .coo-chip-stack {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
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

          .sidebar-brand {
            display: none;
          }

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
          .ops-app-shell {
            flex-direction: column;
          }

          .ops-sidebar {
            display: none;
          }

          .ops-workspace {
            margin-left: 0;
            padding-bottom: 80px; /* Margin to prevent bottom-nav overlaps */
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
          }

          .mobile-brand .brand-title,
          .drawer-header .brand-title {
            font-size: 1rem;
          }

          .mobile-brand .brand-subtitle,
          .drawer-header .brand-subtitle {
            font-size: 0.625rem;
          }

          .hamburger-btn {
            background: none;
            border: none;
            color: #ffffff;
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
            flex: 1;
            min-width: 0;
            height: 100%;
          }

          .bottom-nav-btn {
            background: none;
            border: none;
            cursor: pointer;
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
            max-width: calc(100vw - 32px);
            background-color: var(--navy-sidebar);
            display: flex;
            flex-direction: column;
            animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }

          @keyframes slideIn {
            from {
              transform: translateX(-100%);
            }
            to {
              transform: translateX(0);
            }
          }

          .drawer-header {
            height: 56px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            align-items: center;
            padding: 0 16px;
            color: #ffffff;
            justify-content: space-between;
          }

          .drawer-header .close-btn {
            background: none;
            border: none;
            color: var(--text-light);
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
