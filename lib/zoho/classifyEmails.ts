/**
 * classifyEmails — core email classification logic (Phase 5B / 5B.1).
 *
 * Fetches up to 5 pending or failed records from zoho_email_metadata,
 * classifies each with regex then AI fallback, and persists the results.
 *
 * Safe logging rule: never log access tokens, refresh tokens, or email bodies.
 * Only log boolean success/failure, message IDs, and category results.
 */

import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tryRegexExtract } from "@/lib/classify/regexExtractor";
import { classifyWithAI } from "@/lib/classify/aiClassifier";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ZohoAPIResponse<T> {
  status: {
    code: number;
    description: string;
  };
  data?: T;
}

interface ZohoDetailsData {
  messageId: string;
  sender: string;
  fromAddress?: string;
  subject: string;
  receivedTime: string | number;
  toAddress?: string;
  ccAddress?: string;
  hasAttachment?: string | number;
  size?: string | number;
  folderId?: string;
}

interface ZohoContentData {
  messageId: string;
  content: string;
}

export interface ClassifyResult {
  checked: number;
  classified: number;
  failed: number;
  skipped: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidISODate(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
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

  console.log("[Zoho Classify] refresh access_token_received:", Boolean(newAccessToken));

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

  console.log("[Zoho Classify] Token successfully refreshed and persisted.");
  return newAccessToken;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Classifies up to 5 pending or failed email records.
 * Skips already-classified rows automatically (DB query filter).
 *
 * Throws on configuration or connection errors so the caller can surface
 * an appropriate HTTP response.
 */
export async function classifyEmails(): Promise<ClassifyResult> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const accountsBaseUrl = process.env.ZOHO_ACCOUNTS_BASE_URL;
  const mailBaseUrl = process.env.ZOHO_MAIL_BASE_URL;

  if (!clientId || !clientSecret || !accountsBaseUrl || !mailBaseUrl) {
    throw new Error("Zoho API configuration is incomplete on the server.");
  }

  const supabase = createSupabaseServerClient();

  // Fetch the active Zoho connection
  const { data: connection, error: connError } = await supabase
    .from("zoho_connections")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connError) {
    throw new Error(`Failed to query zoho_connections: ${connError.message}`);
  }

  if (!connection) {
    throw new Error("No active Zoho connection found. Please log in first.");
  }

  // Refresh token if expired or near expiry
  let accessToken: string = connection.access_token;
  const expiresAt = new Date(connection.access_token_expires_at).getTime();
  const bufferTime = 5 * 60 * 1000;

  if (expiresAt < Date.now() + bufferTime) {
    console.log("[Zoho Classify] Access token expired or near expiry. Refreshing...");
    accessToken = await refreshZohoToken(
      connection as Record<string, string>,
      clientId,
      clientSecret,
      accountsBaseUrl,
    );
  }

  // Query up to 5 pending or retryable-failed records
  const { data: pendingEmails, error: pendingError } = await supabase
    .from("zoho_email_metadata")
    .select("*")
    .eq("mailbox_email", connection.email_address)
    .in("classification_status", ["pending", "failed"])
    .order("received_at", { ascending: false })
    .limit(5);

  if (pendingError) {
    throw new Error(`Failed to query pending emails: ${pendingError.message}`);
  }

  const checkedCount = pendingEmails?.length ?? 0;
  let classifiedCount = 0;
  let failedCount = 0;

  const zohoAccountId: string = connection.zoho_account_id;

  for (const emailRecord of pendingEmails ?? []) {
    const messageId: string = emailRecord.message_id;
    const folderId: string = emailRecord.folder_id;

    try {
      const detailsUrl = `${mailBaseUrl}/accounts/${zohoAccountId}/folders/${folderId}/messages/${messageId}/details`;
      const contentUrl = `${mailBaseUrl}/accounts/${zohoAccountId}/folders/${folderId}/messages/${messageId}/content`;

      const [detailsRes, contentRes] = await Promise.all([
        fetch(detailsUrl, {
          headers: {
            Accept: "application/json",
            Authorization: `Zoho-oauthtoken ${accessToken}`,
          },
        }),
        fetch(contentUrl, {
          headers: {
            Accept: "application/json",
            Authorization: `Zoho-oauthtoken ${accessToken}`,
          },
        }),
      ]);

      if (!detailsRes.ok || !contentRes.ok) {
        console.error(
          `[Zoho Classify] Failed to fetch email from Zoho. Details: ${detailsRes.status}, Content: ${contentRes.status}`,
        );
        await supabase
          .from("zoho_email_metadata")
          .update({ classification_status: "failed", updated_at: new Date().toISOString() })
          .eq("id", emailRecord.id);
        failedCount++;
        continue;
      }

      const [detailsPayload, contentPayload] = (await Promise.all([
        detailsRes.json(),
        contentRes.json(),
      ])) as [ZohoAPIResponse<ZohoDetailsData>, ZohoAPIResponse<ZohoContentData>];

      if (detailsPayload.status?.code !== 200 || contentPayload.status?.code !== 200) {
        console.error(
          "[Zoho Classify] Zoho API returned non-success code:",
          detailsPayload.status,
          contentPayload.status,
        );
        await supabase
          .from("zoho_email_metadata")
          .update({ classification_status: "failed", updated_at: new Date().toISOString() })
          .eq("id", emailRecord.id);
        failedCount++;
        continue;
      }

      const details = detailsPayload.data;
      const contentData = contentPayload.data;

      if (!details || !contentData) {
        throw new Error("Zoho API response missing expected data fields.");
      }

      const subject = details.subject || "(No Subject)";
      // bodyText is used for classification only — never stored or logged
      const bodyText = stripHtml(contentData.content || "");

      // Regex-first, AI fallback
      let classification = tryRegexExtract({ subject, body: bodyText });
      if (classification) {
        console.log(
          `[Zoho Classify] Regex classified message ${messageId} as ${classification.category}`,
        );
      } else {
        console.log(`[Zoho Classify] Falling back to AI for message ${messageId}`);
        classification = await classifyWithAI({ subject, body: bodyText });
      }

      const parsedDeadline = isValidISODate(classification.deadline)
        ? classification.deadline
        : null;

      const { error: updateError } = await supabase
        .from("zoho_email_metadata")
        .update({
          category: classification.category,
          confidence: classification.confidence,
          source_portal: classification.source_portal,
          needs_human_review: classification.needs_human_review,
          action_required: classification.action_required,
          deadline: parsedDeadline,
          classified_at: new Date().toISOString(),
          classification_status: "classified",
          updated_at: new Date().toISOString(),
        })
        .eq("id", emailRecord.id);

      if (updateError) {
        console.error(
          `[Zoho Classify] Failed to save classification for message ${messageId}:`,
          updateError.message,
        );
        await supabase
          .from("zoho_email_metadata")
          .update({ classification_status: "failed", updated_at: new Date().toISOString() })
          .eq("id", emailRecord.id);
        failedCount++;
      } else {
        classifiedCount++;
      }
    } catch (error) {
      console.error(
        `[Zoho Classify] Error classifying message ${messageId}:`,
        error instanceof Error ? error.message : "Unknown error",
      );
      await supabase
        .from("zoho_email_metadata")
        .update({ classification_status: "failed", updated_at: new Date().toISOString() })
        .eq("id", emailRecord.id);
      failedCount++;
    }
  }

  console.log(
    `[Zoho Classify] Complete — checked: ${checkedCount}, classified: ${classifiedCount}, failed: ${failedCount}`,
  );

  return { checked: checkedCount, classified: classifiedCount, failed: failedCount, skipped: 0 };
}
