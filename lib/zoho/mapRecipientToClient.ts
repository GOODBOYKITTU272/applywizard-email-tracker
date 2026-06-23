/**
 * mapRecipientToClient — maps an extracted original recipient to a known client.
 *
 * BLOCKER: No real `clients` table exists in Supabase yet. This module matches
 * against mockClients from lib/mockData.ts. Replace with a Supabase query
 * once a real clients table is migrated.
 *
 * Matching is exact (normalized to lowercase). Name matching is not used.
 */

import { mockClients } from "@/lib/mockData";

const ADMIN_MAILBOX = (
  process.env.ZOHO_ADMIN_EMAIL ?? "ramakrishna@applywizard.ai"
).toLowerCase();

export type ClientMappingStatus = "matched" | "unmatched" | "internal" | "admin";

export interface ClientMappingResult {
  /** mock client ID string; null when unmatched/internal/admin. */
  clientId: string | null;
  status: ClientMappingStatus;
}

export function mapRecipientToClient(
  originalRecipient: string | null,
  routingStatus: string,
): ClientMappingResult {
  if (routingStatus === "internal") {
    return { clientId: null, status: "internal" };
  }

  if (!originalRecipient) {
    return { clientId: null, status: "unmatched" };
  }

  const normalized = originalRecipient.toLowerCase().trim();

  if (normalized === ADMIN_MAILBOX) {
    return { clientId: null, status: "admin" };
  }

  const match = mockClients.find(
    (c) => c.mailbox.toLowerCase() === normalized,
  );

  if (match) {
    return { clientId: match.id, status: "matched" };
  }

  return { clientId: null, status: "unmatched" };
}
