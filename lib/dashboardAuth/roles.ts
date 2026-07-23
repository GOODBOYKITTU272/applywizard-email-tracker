import "server-only";

import type { DashboardRole } from "@/lib/dashboardAuth/users";

export function isAdminCeo(role: DashboardRole): boolean {
  return role === "admin_ceo";
}

export function canAccessBroadDashboards(role: DashboardRole): boolean {
  return role === "admin_ceo" || role === "manager_ops";
}

const STAFF_DOMAIN = "applywizz.ai";

const ROLE_OVERRIDES: Readonly<Record<string, DashboardRole>> = {
  "ramakrishna@applywizz.ai": "admin_ceo",
  "ramakrishnaa.tejavath@applywizz.ai": "manager_ops",
  "balaji@applywizz.ai": "manager_ops",
};

export type AutoProvisionDecision =
  | { eligible: true; email: string; role: DashboardRole }
  | { eligible: false };

export function resolveAutoProvisionRole(email: string): AutoProvisionDecision {
  const normalized = email.trim().toLowerCase();
  const [localPart, domain, extra] = normalized.split("@");

  if (!localPart || localPart.includes("+") || /\s/u.test(normalized) || !domain || extra !== undefined || domain !== STAFF_DOMAIN) {
    return { eligible: false };
  }

  return {
    eligible: true,
    email: normalized,
    role: ROLE_OVERRIDES[normalized] ?? "ca",
  };
}
