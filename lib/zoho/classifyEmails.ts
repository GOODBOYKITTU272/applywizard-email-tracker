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
import { classifyEmail } from "@/lib/classify/emailClassification";
import { tryRegexExtract } from "@/lib/classify/regexExtractor";
import { classifyWithAI } from "@/lib/classify/aiClassifier";
import { extractOriginalRecipient } from "@/lib/classify/extractRecipient";
// mapRecipientToClient is intentionally NOT used here: no real clients table exists in Supabase.
// When a real clients table is migrated, import mapRecipientToClient and replace client_id: null.

const DETERMINISTIC_CONFIDENCE_THRESHOLD = 0.8;

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
  review_required: number;
}

export interface DryRunEntry {
  message_id: string;
  sender_domain: string;    // domain portion only — never full email address
  subject: string;          // truncated to 80 characters
  category: string;
  confidence: number;
  priority: string | null;
  needs_human_review: boolean;
  classifier_source: "deterministic" | "regex" | "ai";
  deadline: string | null;
}

export interface DryRunResult {
  dry_run: true;
  mailbox: string;
  checked: number;
  entries: DryRunEntry[];
}

export interface ClassifyOptions {
  /** Dry-run: classify but never write results to Supabase. Requires mailbox. */
  dryRun?: boolean;
  /**
   * Explicit mailbox email address for controlled single-mailbox test runs.
   * Required when dryRun is true. Must be a single address (no commas/semicolons).
   * Maximum batch: 10 emails.
   */
  mailbox?: string;
}

const MAX_DRY_RUN_BATCH = 10;

function senderDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "unknown";
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

// ── Header fetch helper ────────────────────────────────────────────────────────

/**
 * Fetch raw SMTP headers for a message.
 * Returns the raw headerContent string in memory only — never logged or stored.
 * Returns null on any failure so routing can be marked unroutable without
 * failing the classification step.
 */
async function fetchMessageHeaders(
  mailBaseUrl: string,
  zohoAccountId: string,
  folderId: string,
  messageId: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const url = `${mailBaseUrl}/accounts/${zohoAccountId}/folders/${folderId}/messages/${messageId}/header?raw=true`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    });
    if (!res.ok) {
      console.error(`[Zoho Classify] Header fetch failed: ${res.status} for message ${messageId}`);
      return null;
    }
    const payload = (await res.json()) as { status?: { code: number }; data?: { headerContent?: string } };
    if (payload.status?.code !== 200) return null;
    return payload.data?.headerContent ?? null;
  } catch {
    console.error(`[Zoho Classify] Header fetch threw for message ${messageId}`);
    return null;
  }
}

// ── Dry-run implementation ─────────────────────────────────────────────────

// ── Dry-run implementation ─────────────────────────────────────────────────

async function runDryRun(cfg: {
  mailbox: string;
  clientId: string;
  clientSecret: string;
  accountsBaseUrl: string;
  mailBaseUrl: string;
}): Promise<DryRunResult> {
  const supabase = createSupabaseServerClient();

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

  let accessToken: string = connection.access_token;
  const expiresAt = new Date(connection.access_token_expires_at).getTime();
  if (expiresAt < Date.now() + 5 * 60 * 1000) {
    accessToken = await refreshZohoToken(
      connection as Record<string, string>,
      cfg.clientId,
      cfg.clientSecret,
      cfg.accountsBaseUrl,
    );
  }

  const { data: pendingEmails, error: pendingError } = await supabase
    .from("zoho_email_metadata")
    .select("*")
    .eq("mailbox_email", cfg.mailbox)
    .in("classification_status", ["pending", "failed"])
    .order("received_at", { ascending: false })
    .limit(MAX_DRY_RUN_BATCH);

  if (pendingError) {
    throw new Error(`Failed to query pending emails: ${pendingError.message}`);
  }

  const rows = pendingEmails ?? [];
  if (rows.length > MAX_DRY_RUN_BATCH) {
    throw new Error(
      `Dry-run batch exceeds maximum of ${MAX_DRY_RUN_BATCH} emails.`,
    );
  }

  const zohoAccountId: string = connection.zoho_account_id;
  const entries: DryRunEntry[] = [];

  for (const emailRecord of rows) {
    const messageId: string = emailRecord.message_id;
    const folderId: string = emailRecord.folder_id;

    try {
      const detailsUrl = `${cfg.mailBaseUrl}/accounts/${zohoAccountId}/folders/${folderId}/messages/${messageId}/details`;
      const contentUrl = `${cfg.mailBaseUrl}/accounts/${zohoAccountId}/folders/${folderId}/messages/${messageId}/content`;

      const [detailsRes, contentRes] = await Promise.all([
        fetch(detailsUrl, { headers: { Accept: "application/json", Authorization: `Zoho-oauthtoken ${accessToken}` } }),
        fetch(contentUrl, { headers: { Accept: "application/json", Authorization: `Zoho-oauthtoken ${accessToken}` } }),
      ]);

      if (!detailsRes.ok || !contentRes.ok) {
        console.error(`[Zoho DryRun] Failed to fetch email from Zoho. Details: ${detailsRes.status}, Content: ${contentRes.status}`);
        continue;
      }

      const [detailsPayload, contentPayload] = (await Promise.all([
        detailsRes.json(),
        contentRes.json(),
      ])) as [ZohoAPIResponse<ZohoDetailsData>, ZohoAPIResponse<ZohoContentData>];

      if (detailsPayload.status?.code !== 200 || contentPayload.status?.code !== 200) {
        console.error("[Zoho DryRun] Zoho API non-success code:", detailsPayload.status, contentPayload.status);
        continue;
      }

      const details = detailsPayload.data;
      const contentData = contentPayload.data;
      if (!details || !contentData) continue;

      const subject = details.subject || "(No Subject)";
      // bodyText is used for classification only — never stored or logged
      const bodyText = stripHtml(contentData.content || "");
      const sender: string = emailRecord.sender ?? details.sender ?? "";
      const receivedDate: string = emailRecord.received_at ?? "";

      let classifier_source: "deterministic" | "regex" | "ai";
      const deterministicResult = classifyEmail({ subject, body: bodyText, sender, receivedDate });
      let classification;

      if (deterministicResult.category !== "unknown" && deterministicResult.confidence >= DETERMINISTIC_CONFIDENCE_THRESHOLD) {
        classification = deterministicResult;
        classifier_source = "deterministic";
      } else {
        const regexResult = tryRegexExtract({ subject, body: bodyText });
        if (regexResult) {
          classification = regexResult;
          classifier_source = "regex";
        } else {
          classification = await classifyWithAI({ subject, body: bodyText });
          classifier_source = "ai";
        }
      }

      // ponytail: no Supabase write in dry-run — classification result discarded after summary
      entries.push({
        message_id: messageId,
        sender_domain: senderDomain(sender),
        subject: subject.slice(0, 80),
        category: classification.category,
        confidence: classification.confidence,
        priority: (classification as { priority?: string }).priority ?? null,
        needs_human_review: classification.needs_human_review,
        classifier_source,
        deadline: isValidISODate(classification.deadline) ? classification.deadline : null,
      });
    } catch (error) {
      console.error(
        `[Zoho DryRun] Error classifying message ${messageId}:`,
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  console.log(`[Zoho DryRun] Complete — mailbox: ${senderDomain(cfg.mailbox)}, checked: ${rows.length}, classified: ${entries.length}`);

  return { dry_run: true, mailbox: cfg.mailbox, checked: rows.length, entries };
}

export async function classifyEmails(): Promise<ClassifyResult>;
export async function classifyEmails(options: { dryRun: true; mailbox?: string }): Promise<DryRunResult>;
export async function classifyEmails(options?: ClassifyOptions): Promise<ClassifyResult | DryRunResult>;
/**
 * Classifies up to 5 pending or failed email records (live path), or
 * performs a dry-run classification for a single approved mailbox without
 * writing any results to Supabase.
 *
 * Throws on configuration, connection, or guardrail errors so the caller
 * can surface an appropriate HTTP response.
 */
export async function classifyEmails(
  options?: ClassifyOptions,
): Promise<ClassifyResult | DryRunResult> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const accountsBaseUrl = process.env.ZOHO_ACCOUNTS_BASE_URL;
  const mailBaseUrl = process.env.ZOHO_MAIL_BASE_URL;

  // ── Dry-run guardrails (checked before env-vars to give clear error messages)
  if (options?.dryRun) {
    const { mailbox } = options;

    if (!mailbox || mailbox.trim() === "") {
      throw new Error(
        "Dry-run requires an explicit mailbox address. No mailbox provided.",
      );
    }
    if (/[,;]/.test(mailbox) || mailbox.trim().includes(" ")) {
      throw new Error(
        "Dry-run permits only one mailbox per run. Multiple addresses are not allowed.",
      );
    }

    if (!clientId || !clientSecret || !accountsBaseUrl || !mailBaseUrl) {
      throw new Error("Zoho API configuration is incomplete on the server.");
    }

    return runDryRun({
      mailbox: mailbox.trim(),
      clientId,
      clientSecret,
      accountsBaseUrl,
      mailBaseUrl,
    });
  }

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

  // ponytail: clamp 1–200; invalid/missing → 50
  const classifyMaxPerRun = Math.min(200, Math.max(1, parseInt(process.env.ZOHO_CLASSIFY_MAX_PER_RUN ?? "50", 10) || 50));

  const { data: pendingEmails, error: pendingError } = await supabase
    .from("zoho_email_metadata")
    .select("*")
    .eq("mailbox_email", connection.email_address)
    .in("classification_status", ["pending", "failed"])
    .order("received_at", { ascending: true })
    .limit(classifyMaxPerRun);

  if (pendingError) {
    throw new Error(`Failed to query pending emails: ${pendingError.message}`);
  }

  const checkedCount = pendingEmails?.length ?? 0;
  let classifiedCount = 0;
  let failedCount = 0;
  let reviewRequiredCount = 0;

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
      const sender: string = emailRecord.sender ?? details.sender ?? "";
      const receivedDate: string = emailRecord.received_at ?? "";

      // ── Routing extraction (header fetch is best-effort; failure → unroutable, not failed) ──
      const rawHeaders = await fetchMessageHeaders(
        mailBaseUrl, zohoAccountId, folderId, messageId, accessToken,
      );
      const routingResult = extractOriginalRecipient({
        rawHeaders: rawHeaders ?? "",
        toAddress: details.toAddress ?? "",
        ccAddress: details.ccAddress ?? "",
        fromAddress: details.fromAddress ?? sender,
        trackerMailbox: connection.email_address,
      });
      console.log(
        `[Zoho Classify] Routing message ${messageId}: ${routingResult.routingStatus} (${routingResult.reasonCode})`,
      );

      // Step 1 — deterministic classifier (free, no API cost)
      let classifier_source: "deterministic" | "regex" | "ai";
      const deterministicResult = classifyEmail({ subject, body: bodyText, sender, receivedDate });
      let classification;

      if (
        deterministicResult.category !== "unknown" &&
        deterministicResult.confidence >= DETERMINISTIC_CONFIDENCE_THRESHOLD
      ) {
        classification = deterministicResult;
        classifier_source = "deterministic";
        console.log(
          `[Zoho Classify] Deterministic classified message ${messageId} as ${classification.category}`,
        );
      } else {
        // Step 2 — regex extractor (OTP/verify/account fast path)
        const regexResult = tryRegexExtract({ subject, body: bodyText });
        if (regexResult) {
          classification = regexResult;
          classifier_source = "regex";
          console.log(
            `[Zoho Classify] Regex classified message ${messageId} as ${classification.category}`,
          );
        } else {
          // Step 3 — AI fallback
          console.log(`[Zoho Classify] Falling back to AI for message ${messageId}`);
          classification = await classifyWithAI({ subject, body: bodyText });
          classifier_source = "ai";
        }
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
          priority: (classification as { priority?: string }).priority ?? null,
          reason: (classification as { reason?: string }).reason ?? null,
          classifier_source,
          // routing fields — client_id always null until real clients table exists
          original_recipient: routingResult.originalRecipient,
          email_direction: routingResult.direction,
          routing_confidence: routingResult.routingConfidence,
          routing_status: routingResult.routingStatus,
          client_id: null,
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
        if (classification.needs_human_review) reviewRequiredCount++;
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
    `[Zoho Classify] Complete — checked: ${checkedCount}, classified: ${classifiedCount}, failed: ${failedCount}, review_required: ${reviewRequiredCount}`,
  );

  return { checked: checkedCount, classified: classifiedCount, failed: failedCount, skipped: 0, review_required: reviewRequiredCount };
}
