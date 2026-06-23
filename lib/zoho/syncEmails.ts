/**
 * syncEmails — core Zoho mail metadata sync logic (Phase 5A).
 *
 * Fetches the latest email metadata from Zoho Mail, upserts safe metadata
 * into zoho_email_metadata, and returns a typed summary.
 *
 * Safe logging rule: never log access tokens, refresh tokens, or email bodies.
 * Only log boolean success/failure and counts.
 */

import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ZohoEmailItem {
  messageId: string;
  sender: string;
  fromAddress?: string;
  subject: string;
  receivedTime: string | number;
  folderName?: string;
  folderId?: string;
  hasAttachment?: string | number;
}

interface ZohoAPIResponse<T> {
  status: {
    code: number;
    description: string;
  };
  data?: T;
}

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
}

// ── Token refresh helper ───────────────────────────────────────────────────────

async function refreshZohoToken(
  connection: Record<string, string>,
  clientId: string,
  clientSecret: string,
  accountsBaseUrl: string,
): Promise<string> {
  const tokenResponse = await fetch(`${accountsBaseUrl}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
    }).toString(),
  });

  const parsed: unknown = await tokenResponse.json();

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid response format from Zoho token endpoint.");
  }

  const tokenData = parsed as Record<string, unknown>;

  if (!tokenResponse.ok || tokenData.error) {
    throw new Error(
      `Zoho token refresh failed: ${String(tokenData.error ?? tokenResponse.status)}`,
    );
  }

  const newAccessToken =
    typeof tokenData.access_token === "string" && tokenData.access_token
      ? tokenData.access_token
      : null;
  const expiresIn = Number(tokenData.expires_in);

  console.log("[Zoho Sync] refresh access_token_received:", Boolean(newAccessToken));

  if (!newAccessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Zoho returned incomplete data during token refresh.");
  }

  const supabase = createSupabaseServerClient();
  const refreshTime = new Date();
  const newExpiresAt = new Date(refreshTime.getTime() + expiresIn * 1000);

  const { error: updateError } = await supabase
    .from("zoho_connections")
    .update({
      access_token: newAccessToken,
      access_token_expires_at: newExpiresAt.toISOString(),
      last_refresh_at: refreshTime.toISOString(),
      updated_at: refreshTime.toISOString(),
    })
    .eq("zoho_account_id", connection.zoho_account_id);

  if (updateError) {
    throw new Error(
      `Failed to persist refreshed access token: ${updateError.message}`,
    );
  }

  console.log("[Zoho Sync] Token successfully refreshed and persisted.");
  return newAccessToken;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Runs one sync cycle: fetches the latest 10 emails from Zoho Mail and
 * upserts their safe metadata into zoho_email_metadata.
 *
 * Throws on configuration or connection errors so the caller can surface
 * an appropriate HTTP response.
 */
export async function syncEmails(): Promise<SyncResult> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const accountsBaseUrl = process.env.ZOHO_ACCOUNTS_BASE_URL;
  const mailBaseUrl = process.env.ZOHO_MAIL_BASE_URL;

  if (!clientId || !clientSecret || !accountsBaseUrl || !mailBaseUrl) {
    throw new Error("Zoho API configuration is incomplete on the server.");
  }

  const syncMailbox = process.env.ZOHO_SYNC_MAILBOX?.toLowerCase().trim();
  if (!syncMailbox) {
    throw new Error(
      "ZOHO_SYNC_MAILBOX is not configured. Set it to the exact tracker mailbox address.",
    );
  }

  const supabase = createSupabaseServerClient();

  // Fetch the active Zoho connection for the configured tracker mailbox only.
  // Explicit email_address filter prevents silent fallback to any other mailbox.
  const { data: connection, error: connError } = await supabase
    .from("zoho_connections")
    .select("*")
    .eq("status", "active")
    .eq("email_address", syncMailbox)
    .maybeSingle();

  if (connError) {
    throw new Error(`Failed to query zoho_connections: ${connError.message}`);
  }

  if (!connection) {
    throw new Error(
      `No active Zoho connection found for configured sync mailbox. Connect it via /api/zoho/login first.`,
    );
  }

  // Refresh token if expired or near expiry
  let accessToken: string = connection.access_token;
  const expiresAt = new Date(connection.access_token_expires_at).getTime();
  const bufferTime = 5 * 60 * 1000;

  if (expiresAt < Date.now() + bufferTime) {
    console.log("[Zoho Sync] Access token expired or near expiry. Refreshing...");
    accessToken = await refreshZohoToken(
      connection as Record<string, string>,
      clientId,
      clientSecret,
      accountsBaseUrl,
    );
  }

  // Fetch latest emails from Zoho Mail
  const zohoAccountId: string = connection.zoho_account_id;
  const emailsUrl = `${mailBaseUrl}/accounts/${zohoAccountId}/messages/view?limit=10`;
  console.log(
    "[Zoho Sync] Fetching latest emails from:",
    emailsUrl.replace(zohoAccountId, "ANONYMIZED_ID"),
  );

  const emailResponse = await fetch(emailsUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });

  const parsedPayload = (await emailResponse.json()) as ZohoAPIResponse<ZohoEmailItem[]>;

  if (!emailResponse.ok || parsedPayload.status?.code !== 200) {
    throw new Error(
      `Zoho messages request failed: ${emailResponse.status} / ${parsedPayload.status?.description ?? "unknown"}`,
    );
  }

  const messages = Array.isArray(parsedPayload.data) ? parsedPayload.data : [];

  if (messages.length === 0) {
    return { fetched: 0, inserted: 0, updated: 0, skipped: 0 };
  }

  // Determine which records already exist
  const messageIds = messages.map((item) => item.messageId);
  const { data: existingRecords, error: existingError } = await supabase
    .from("zoho_email_metadata")
    .select("message_id")
    .eq("mailbox_email", connection.email_address)
    .in("message_id", messageIds);

  if (existingError) {
    throw new Error(`Failed to query existing metadata: ${existingError.message}`);
  }

  const existingMsgIds = new Set(existingRecords?.map((r) => r.message_id) ?? []);

  let insertedCount = 0;
  let updatedCount = 0;
  const nowTime = new Date().toISOString();

  const upsertPayload = messages.map((item) => {
    const receivedTime = Number(item.receivedTime);
    const receivedAt = Number.isFinite(receivedTime)
      ? new Date(receivedTime).toISOString()
      : nowTime;
    const hasAttachments =
      item.hasAttachment === "1" ||
      item.hasAttachment === 1 ||
      Boolean(Number(item.hasAttachment));

    if (existingMsgIds.has(item.messageId)) {
      updatedCount++;
    } else {
      insertedCount++;
    }

    return {
      zoho_connection_id: connection.id,
      mailbox_email: connection.email_address,
      message_id: item.messageId,
      sender: item.sender || item.fromAddress || "unknown",
      subject: item.subject || "(No Subject)",
      received_at: receivedAt,
      folder_id: item.folderId || "unknown",
      folder_name: item.folderName || "Inbox",
      has_attachments: hasAttachments,
      attachment_count: hasAttachments ? 1 : 0,
      sync_status: "synced",
      last_seen_at: nowTime,
      updated_at: nowTime,
    };
  });

  const { error: upsertError } = await supabase
    .from("zoho_email_metadata")
    .upsert(upsertPayload, { onConflict: "mailbox_email,message_id" });

  if (upsertError) {
    throw new Error(`Failed to upsert email metadata: ${upsertError.message}`);
  }

  console.log(
    `[Zoho Sync] Complete — fetched: ${messages.length}, inserted: ${insertedCount}, updated: ${updatedCount}`,
  );

  return {
    fetched: messages.length,
    inserted: insertedCount,
    updated: updatedCount,
    skipped: 0,
  };
}
