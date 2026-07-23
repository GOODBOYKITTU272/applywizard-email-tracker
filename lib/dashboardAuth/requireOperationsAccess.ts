import "server-only";

import { redirect } from "next/navigation";

import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
import { canAccessBroadDashboards } from "@/lib/dashboardAuth/roles";
import type { DashboardSession } from "@/lib/dashboardAuth/sessionStore";

/**
 * Server-component guard for broad operations pages: requires a valid
 * session AND admin_ceo/manager_ops. A ca session is redirected to
 * /access-pending before any operational data is read or rendered.
 */
export async function requireOperationsAccess(): Promise<DashboardSession> {
  const session = await requireDashboardSession();

  if (!canAccessBroadDashboards(session.user.role)) {
    redirect("/access-pending");
  }

  return session;
}
