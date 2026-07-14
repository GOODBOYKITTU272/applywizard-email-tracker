import "server-only";

import type { DashboardRole } from "@/lib/dashboardAuth/users";

export function isAdminCeo(role: DashboardRole): boolean {
  return role === "admin_ceo";
}

export function canAccessBroadDashboards(role: DashboardRole): boolean {
  return isAdminCeo(role);
}
