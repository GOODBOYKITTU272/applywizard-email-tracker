import "server-only";

import { getLeadByEmail } from "@/lib/leadsApi/getLeadByEmail";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const IST_TIME_ZONE = "Asia/Kolkata";

export interface EmailArrivalRow {
  original_recipient: string | null;
  received_at: string | null;
}

export interface EmailArrivalMailboxSummary {
  originalRecipient: string;
  clientName: string;
  assignedCaName: string;
  assignedCaEmail: string;
  emailsToday: number;
  latestEmailAt: string;
}

export interface EmailArrivalMonitorData {
  rows: EmailArrivalMailboxSummary[];
  totalEmailsToday: number;
  latestEmailAt: string | null;
  activeMailboxesToday: number;
}

export type GetEmailArrivalMonitorResult = { ok: true; data: EmailArrivalMonitorData } | { ok: false };

interface SupabaseQuery {
  gte(column: string, value: string): SupabaseQuery;
  lte(column: string, value: string): SupabaseQuery;
  then(resolve: (value: { data: EmailArrivalRow[] | null; error: { message: string } | null }) => void): Promise<void>;
}

interface SupabaseLike {
  from(table: string): {
    select(columns: string): SupabaseQuery;
  };
}

export function getIstDayBounds(now = new Date()): { startUtc: string; endUtc: string } {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const startUtc = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - IST_OFFSET_MS);
  const endUtc = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 23, 59, 59, 999) - IST_OFFSET_MS);

  return {
    startUtc: startUtc.toISOString(),
    endUtc: endUtc.toISOString(),
  };
}

export function formatIstTime(value: string | null): string {
  if (!value) return "Not available yet";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

export async function getEmailArrivalMonitorData(now = new Date()): Promise<GetEmailArrivalMonitorResult> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { startUtc, endUtc } = getIstDayBounds(now);

    const { data, error } = await supabase
      .from("zoho_email_metadata")
      .select("original_recipient, received_at")
      .gte("received_at", startUtc)
      .lte("received_at", endUtc);

    if (error || !data) return { ok: false };

    const byMailbox = new Map<string, { emailsToday: number; latestEmailAt: string }>();
    for (const row of data) {
      const recipient = row.original_recipient?.trim();
      const receivedAt = row.received_at;
      if (!recipient || !receivedAt) continue;

      const existing = byMailbox.get(recipient);
      if (!existing) {
        byMailbox.set(recipient, { emailsToday: 1, latestEmailAt: receivedAt });
        continue;
      }

      existing.emailsToday += 1;
      if (receivedAt > existing.latestEmailAt) {
        existing.latestEmailAt = receivedAt;
      }
    }

    const rows = Array.from(byMailbox.entries())
      .map(([originalRecipient, value]) => ({
        originalRecipient,
        emailsToday: value.emailsToday,
        latestEmailAt: value.latestEmailAt,
      }))
      .sort((left, right) => right.latestEmailAt.localeCompare(left.latestEmailAt));

    const rowsWithLeads = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        ...(await getLeadByEmail(row.originalRecipient)),
      })),
    );

    const totalEmailsToday = rowsWithLeads.reduce((sum, row) => sum + row.emailsToday, 0);

    return {
      ok: true,
      data: {
        rows: rowsWithLeads,
        totalEmailsToday,
        latestEmailAt: rowsWithLeads[0]?.latestEmailAt ?? null,
        activeMailboxesToday: rowsWithLeads.length,
      },
    };
  } catch {
    return { ok: false };
  }
}
