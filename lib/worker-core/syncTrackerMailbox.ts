import { syncEmails, type SyncResult } from "@/lib/zoho/syncEmails";

export function syncTrackerMailbox(): Promise<SyncResult> {
  return syncEmails();
}
