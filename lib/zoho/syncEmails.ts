/**
 * syncEmails — core Zoho mail metadata sync logic (Phase 5A / backlog-safe).
 *
 * Fetches email metadata from Zoho Mail in paginated oldest-first order,
 * upserts safe metadata into zoho_email_metadata, and returns a typed summary.
 *
 * Safe logging rule: never log access tokens, refresh tokens, or email bodies.
 * Only log boolean success/failure and counts.
 */

import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

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
  has_more: boolean;
}

interface SyncCheckpointRow {
  mailbox_email: string;
  last_seen_message_id: string | null;
  last_seen_received_at: string | null;
  last_successful_sync_at?: string | null;
}

const DEFAULT_REPLAY_WINDOW_MINUTES = 30;

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

  const supabase = createSupabaseServiceRoleClient();
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
 * Runs one sync cycle: paginates oldest-first through the tracker inbox,
 * upserts safe metadata into zoho_email_metadata, and stops at the per-run cap.
 *
 * Environment variables:
 *   ZOHO_SYNC_PAGE_SIZE   — emails per Zoho API request (default 25, max 100)
 *   ZOHO_SYNC_MAX_PER_RUN — total emails fetched per cron run (default 100, max 500)
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

  // ponytail: clamp page size 1–100; invalid/missing → 25
  const pageSize = Math.min(100, Math.max(1, parseInt(process.env.ZOHO_SYNC_PAGE_SIZE ?? "25", 10) || 25));
  // ponytail: clamp max per run 1–500; invalid/missing → 100
  const maxPerRun = Math.min(500, Math.max(1, parseInt(process.env.ZOHO_SYNC_MAX_PER_RUN ?? "100", 10) || 100));
  // ponytail: fast-ingest overlap only; reconciliation/backfill stays separate
  const replayWindowMinutes = Math.min(
    240,
    Math.max(
      1,
      parseInt(
        process.env.ZOHO_SYNC_REPLAY_WINDOW_MINUTES ?? `${DEFAULT_REPLAY_WINDOW_MINUTES}`,
        10,
      ) || DEFAULT_REPLAY_WINDOW_MINUTES,
    ),
  );

  const supabase = createSupabaseServiceRoleClient();

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

  const zohoAccountId: string = connection.zoho_account_id;
  const { data: checkpointRow, error: checkpointError } = await supabase
    .from("zoho_sync_checkpoints")
    .select("mailbox_email,last_seen_message_id,last_seen_received_at,last_successful_sync_at")
    .eq("mailbox_email", connection.email_address)
    .maybeSingle();

  if (checkpointError) {
    throw new Error(`Failed to query sync checkpoint: ${checkpointError.message}`);
  }

  const checkpoint = (checkpointRow ?? null) as SyncCheckpointRow | null;

  // ── Paginated fetch loop (fast ingest, newest-first) ────────────────────────
  // ponytail: this is a recent-overlap ingest path for fresh visibility.
  // Full historical reconciliation belongs in a separate backfill worker.

  let offset = 0;
  let totalFetched = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let hasMore = false;
  let newestMessageId: string | null = null;
  let newestReceivedAt: string | null = null;

  function toReceivedAt(item: ZohoEmailItem, fallbackIso: string): string {
    const receivedTime = Number(item.receivedTime);
    return Number.isFinite(receivedTime)
      ? new Date(receivedTime).toISOString()
      : fallbackIso;
  }

  function getReplayWindowStartIso(): string | null {
    if (!checkpoint?.last_successful_sync_at) return null;
    return new Date(
      new Date(checkpoint.last_successful_sync_at).getTime() -
        replayWindowMinutes * 60 * 1000,
    ).toISOString();
  }

  const replayWindowStartIso = getReplayWindowStartIso();

  while (totalFetched < maxPerRun) {
    // Never request more than remaining cap allows
    const thisLimit = Math.min(pageSize, maxPerRun - totalFetched);
    const emailsUrl = `${mailBaseUrl}/accounts/${zohoAccountId}/messages/view?limit=${thisLimit}&start=${offset}`;

    console.log(
      `[Zoho Sync] Fetching page — limit: ${thisLimit}, start: ${offset}`,
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

    if (messages.length === 0) break;
    if (!newestMessageId && messages[0]) {
      newestMessageId = messages[0].messageId;
      newestReceivedAt = toReceivedAt(messages[0], new Date().toISOString());
    }

    // Determine which records already exist (idempotency check)
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
    const nowTime = new Date().toISOString();

    const upsertPayload = messages.map((item) => {
      const receivedAt = toReceivedAt(item, nowTime);
      const hasAttachments =
        item.hasAttachment === "1" ||
        item.hasAttachment === 1 ||
        Boolean(Number(item.hasAttachment));

      if (existingMsgIds.has(item.messageId)) {
        totalUpdated++;
      } else {
        totalInserted++;
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

    totalFetched += messages.length;
    offset += messages.length;

    if (messages.length < thisLimit) {
      // Fewer returned than requested — definitively at end of inbox
      hasMore = false;
      break;
    }

    if (totalFetched >= maxPerRun) {
      // Hit the per-run cap — there may be more emails on next run
      hasMore = true;
      break;
    }

    const oldestMessageReceivedAt = toReceivedAt(
      messages[messages.length - 1],
      nowTime,
    );
    if (
      replayWindowStartIso &&
      oldestMessageReceivedAt < replayWindowStartIso
    ) {
      break;
    }
  }

  if (newestMessageId && newestReceivedAt) {
    const checkpointPayload: SyncCheckpointRow = {
      mailbox_email: connection.email_address,
      last_seen_message_id: newestMessageId,
      last_seen_received_at: newestReceivedAt,
      last_successful_sync_at: new Date().toISOString(),
    };

    const { error: checkpointUpsertError } = await supabase
      .from("zoho_sync_checkpoints")
      .upsert([checkpointPayload], { onConflict: "mailbox_email" });

    if (checkpointUpsertError) {
      throw new Error(`Failed to persist sync checkpoint: ${checkpointUpsertError.message}`);
    }
  }

  console.log(
    `[Zoho Sync] Complete — fetched: ${totalFetched}, inserted: ${totalInserted}, updated: ${totalUpdated}, has_more: ${hasMore}`,
  );

  return {
    fetched: totalFetched,
    inserted: totalInserted,
    updated: totalUpdated,
    skipped: 0,
    has_more: hasMore,
  };
}
