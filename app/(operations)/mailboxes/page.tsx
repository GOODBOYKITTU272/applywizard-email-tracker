import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
import MailboxConnectionsClient from "./mailboxes-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MailboxConnectionsPage() {
  await requireDashboardSession();

  return <MailboxConnectionsClient />;
}
