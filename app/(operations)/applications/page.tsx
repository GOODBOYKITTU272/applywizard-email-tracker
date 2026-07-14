import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
import ApplicationsClient from "./applications-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ApplicationsPage() {
  await requireDashboardSession();

  return <ApplicationsClient />;
}
