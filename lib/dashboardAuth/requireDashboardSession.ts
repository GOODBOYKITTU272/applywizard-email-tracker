import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  getDashboardSessionByToken,
  type DashboardSession,
} from "@/lib/dashboardAuth/sessionStore";
import { DASHBOARD_SESSION_COOKIE_NAME } from "@/lib/dashboardAuth/sessionCookie";

export async function requireDashboardSession(): Promise<DashboardSession> {
  try {
    const cookieStore = await cookies();
    const rawSessionToken = cookieStore.get(DASHBOARD_SESSION_COOKIE_NAME)?.value;

    if (rawSessionToken) {
      const result = await getDashboardSessionByToken(rawSessionToken);
      if (result.ok) {
        return result.session;
      }
    }
  } catch {
    // Fail closed: uncertainty means no protected page access.
  }

  redirect("/dashboard/login");
}
