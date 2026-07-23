import { requireOperationsAccess } from "@/lib/dashboardAuth/requireOperationsAccess";
import MailboxConnectionsClient from "./mailboxes-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MailboxConnectionsPage() {
  await requireOperationsAccess();

  return <MailboxConnectionsClient />;
}
