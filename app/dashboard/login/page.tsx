import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardAuthClient } from "@/components/dashboard-auth/dashboard-auth-client";
import { getDashboardSessionByToken } from "@/lib/dashboardAuth/sessionStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardLoginPage() {
  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get("dashboard_session")?.value;

  if (rawSessionToken) {
    let sessionResult: Awaited<ReturnType<typeof getDashboardSessionByToken>> | null = null;
    try {
      sessionResult = await getDashboardSessionByToken(rawSessionToken);
    } catch {
      // Fail closed: render the login flow.
    }

    if (sessionResult?.ok) {
      redirect("/overview");
    }
  }

  return <DashboardAuthClient />;
}
