import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
import ApplicationDetailClient from "./application-detail-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = Promise<{ applicationId: string }>;

export default async function ApplicationDetailPage({ params }: { params: Params }) {
  await requireDashboardSession();

  return <ApplicationDetailClient params={params} />;
}
