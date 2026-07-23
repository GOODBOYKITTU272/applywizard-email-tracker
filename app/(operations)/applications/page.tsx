import { requireOperationsAccess } from "@/lib/dashboardAuth/requireOperationsAccess";
import ApplicationsClient from "./applications-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ApplicationsPage() {
  await requireOperationsAccess();

  return <ApplicationsClient />;
}
