/**
 * mapRecipientToClient — maps an extracted original recipient to an active client
 * in the Supabase `clients` table (Live Monitor V1).
 *
 * DB-backed exact match on `recipient_email_normalized` (lower+trim), active
 * clients only. Never throws: any DB error is treated as unmatched so a mapping
 * failure can never block classification of an email.
 */

const ADMIN_MAILBOX = (process.env.ZOHO_ADMIN_EMAIL ?? "ramakrishna@applywizard.ai").trim().toLowerCase();

export type RecipientMappingStatus = "matched" | "unmatched" | "internal" | "admin";

export type RecipientMappingResult =
  | { status: "matched"; normalizedRecipient: string; clientId: string }
  | { status: "unmatched"; normalizedRecipient: string | null; clientId: null }
  | { status: "internal"; normalizedRecipient: string; clientId: null }
  | { status: "admin"; normalizedRecipient: string; clientId: null };

export interface ClientLookupSupabase {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string | boolean): {
        eq(column: string, value: string | boolean): {
          maybeSingle(): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
        };
      };
    };
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export async function mapRecipientToClient(
  supabase: ClientLookupSupabase,
  originalRecipient: string | null,
  routingStatus: string,
): Promise<RecipientMappingResult> {
  // Internal routing is decided upstream by the recipient extractor; honor it first.
  if (routingStatus === "internal") {
    return { status: "internal", normalizedRecipient: originalRecipient ? normalize(originalRecipient) : "", clientId: null };
  }

  if (!originalRecipient || !originalRecipient.trim()) {
    return { status: "unmatched", normalizedRecipient: null, clientId: null };
  }

  const normalized = normalize(originalRecipient);

  if (normalized === ADMIN_MAILBOX) {
    return { status: "admin", normalizedRecipient: normalized, clientId: null };
  }

  try {
    const { data, error } = await supabase
      .from("clients")
      .select("id")
      .eq("recipient_email_normalized", normalized)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data?.id) {
      return { status: "unmatched", normalizedRecipient: normalized, clientId: null };
    }

    return { status: "matched", normalizedRecipient: normalized, clientId: String(data.id) };
  } catch {
    // Never block classification because the lookup failed.
    return { status: "unmatched", normalizedRecipient: normalized, clientId: null };
  }
}
