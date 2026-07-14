/**
 * classifyEmails — core email classification logic (Phase 5B / 5B.1).
 *
 * Fetches up to 5 pending or failed records from zoho_email_metadata,
 * classifies each with regex then AI fallback, and persists the results.
 *
 * Safe logging rule: never log access tokens, refresh tokens, or email bodies.
 * Only log boolean success/failure, message IDs, and category results.
 */

import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { classifyEmail } from "@/lib/classify/emailClassification";
import { tryRegexExtract } from "@/lib/classify/regexExtractor";
import { classifyWithAI } from "@/lib/classify/aiClassifier";
import { extractOriginalRecipient } from "@/lib/classify/extractRecipient";
import { sanitizeReason } from "@/lib/classify/sanitizeReason";
import { refreshZohoToken, stripHtml } from "@/lib/zoho/zohoApiHelpers";
import {
  claimEmailsForClassification,
  getRetryDisposition,
  getSafeProcessingError,
  updateClaimedEmail,
} from "@/lib/zoho/queueFoundation";
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

function getTrackerMailboxOrThrow(): string {
  const trackerMailbox = process.env.ZOHO_SYNC_MAILBOX?.toLowerCase().trim();
  if (!trackerMailbox) {
    throw new Error(
      "ZOHO_SYNC_MAILBOX is not configured. Set it to the exact tracker mailbox address.",
    );
  }

  return trackerMailbox;
}

function senderDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "unknown";
}

function isValidISODate(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
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
  const supabase = createSupabaseServiceRoleClient();
  const trackerMailbox = getTrackerMailboxOrThrow();
  const normalizedMailbox = cfg.mailbox.toLowerCase().trim();

  if (normalizedMailbox !== trackerMailbox) {
    throw new Error(
      "Dry-run mailbox must match the configured tracker mailbox exactly.",
    );
  }

  const { data: connection, error: connError } = await supabase
    .from("zoho_connections")
    .select("*")
    .eq("status", "active")
    .eq("email_address", normalizedMailbox)
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
      connection as { zoho_account_id: string; refresh_token: string },
      cfg.clientId,
      cfg.clientSecret,
      cfg.accountsBaseUrl,
    );
  }

  const { data: pendingEmails, error: pendingError } = await supabase
    .from("zoho_email_metadata")
    .select("*")
    .eq("mailbox_email", normalizedMailbox)
    .in("classification_status", ["pending", "retry_scheduled"])
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

  return { dry_run: true, mailbox: normalizedMailbox, checked: rows.length, entries };
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

  const supabase = createSupabaseServiceRoleClient();
  const trackerMailbox = getTrackerMailboxOrThrow();

  // Fetch the active Zoho connection
  const { data: connection, error: connError } = await supabase
    .from("zoho_connections")
    .select("*")
    .eq("status", "active")
    .eq("email_address", trackerMailbox)
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
      connection as { zoho_account_id: string; refresh_token: string },
      clientId,
      clientSecret,
      accountsBaseUrl,
    );
  }

  // ponytail: clamp 1–200; invalid/missing → 50
  const classifyMaxPerRun = Math.min(200, Math.max(1, parseInt(process.env.ZOHO_CLASSIFY_MAX_PER_RUN ?? "50", 10) || 50));
  const workerId = `classify-${crypto.randomUUID()}`;

  const pendingEmails = await claimEmailsForClassification(
    supabase as unknown as Parameters<typeof claimEmailsForClassification>[0],
    connection.email_address,
    workerId,
    classifyMaxPerRun,
  );

  const checkedCount = pendingEmails?.length ?? 0;
  let classifiedCount = 0;
  let failedCount = 0;
  let reviewRequiredCount = 0;
  let skippedCount = 0;

  const zohoAccountId: string = connection.zoho_account_id;

  async function scheduleFailure(
    emailRecord: Record<string, unknown>,
    safeError: { code: string; message: string },
  ): Promise<"retry_scheduled" | "dead_letter" | "stale_skip"> {
    const nowIso = new Date().toISOString();
    const disposition = getRetryDisposition(
      Number(emailRecord.attempt_count ?? 0),
      nowIso,
    );

    const updated = await updateClaimedEmail(
      supabase as unknown as Parameters<typeof updateClaimedEmail>[0],
      {
        id: String(emailRecord.id),
        workerId,
        nowIso,
        payload: {
          classification_status: disposition.status,
          next_retry_at: disposition.nextRetryAt,
          dead_lettered_at: disposition.deadLetteredAt,
          last_error_code: safeError.code,
          last_error_message_safe: safeError.message,
          updated_at: nowIso,
          claim_expires_at: null,
        },
      },
    );

    if (!updated) return "stale_skip";
    return disposition.status;
  }

  for (const emailRecord of pendingEmails ?? []) {
    const messageId = String(emailRecord.message_id ?? "");
    const folderId = String(emailRecord.folder_id ?? "");

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
        const failureStatus = await scheduleFailure(
          emailRecord,
          getSafeProcessingError({
            stage: "zoho",
            statusCode:
              detailsRes.status === 429 || contentRes.status === 429
                ? 429
                : detailsRes.status === 401 || detailsRes.status === 403 || contentRes.status === 401 || contentRes.status === 403
                  ? detailsRes.status
                  : undefined,
          }),
        );
        if (failureStatus === "stale_skip") skippedCount++;
        else failedCount++;
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
        const failureStatus = await scheduleFailure(
          emailRecord,
          getSafeProcessingError({
            stage: "zoho",
            statusCode:
              detailsPayload.status?.code === 429 || contentPayload.status?.code === 429
                ? 429
                : detailsPayload.status?.code === 401 || detailsPayload.status?.code === 403
                  ? detailsPayload.status?.code
                  : contentPayload.status?.code === 401 || contentPayload.status?.code === 403
                    ? contentPayload.status?.code
                    : undefined,
          }),
        );
        if (failureStatus === "stale_skip") skippedCount++;
        else failedCount++;
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
      const sender = String(emailRecord.sender ?? details.sender ?? "");
      const receivedDate = String(emailRecord.received_at ?? "");

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
      const safeReason = sanitizeReason(
        (classification as { reason?: string }).reason ?? null,
      );
      const finalizedAt = new Date().toISOString();
      const didUpdate = await updateClaimedEmail(
        supabase as unknown as Parameters<typeof updateClaimedEmail>[0],
        {
          id: String(emailRecord.id),
          workerId,
          nowIso: finalizedAt,
          payload: {
            category: classification.category,
            confidence: classification.confidence,
            source_portal: classification.source_portal,
            needs_human_review: classification.needs_human_review,
            action_required: classification.action_required,
            deadline: parsedDeadline,
            priority: (classification as { priority?: string }).priority ?? null,
            company_name: (classification as { company_name?: string | null }).company_name ?? null,
            job_title: (classification as { job_title?: string | null }).job_title ?? null,
            reason: safeReason,
            classifier_source,
            // routing fields — client_id always null until real clients table exists
            original_recipient: routingResult.originalRecipient,
            email_direction: routingResult.direction,
            routing_confidence: routingResult.routingConfidence,
            routing_status: routingResult.routingStatus,
            client_id: null,
            classified_at: finalizedAt,
            classification_status: classification.needs_human_review ? "review" : "classified",
            next_retry_at: null,
            dead_lettered_at: null,
            last_error_code: null,
            last_error_message_safe: null,
            claim_expires_at: null,
            updated_at: finalizedAt,
          },
        },
      );

      if (!didUpdate) {
        skippedCount++;
      } else {
        classifiedCount++;
        if (classification.needs_human_review) reviewRequiredCount++;
      }
    } catch (error) {
      const safeError = getSafeProcessingError({
        stage:
          error instanceof Error && error.message.startsWith("Failed to update claimed email:")
            ? "supabase"
            : error instanceof Error && (
                error.message.includes("invalid JSON") ||
                error.message.includes("cannot parse") ||
                error.message.includes("OPENAI") ||
                error.message.includes("timed out") ||
                error.message.includes("timeout") ||
                error.message.includes("503") ||
                error.message.includes("502")
              )
              ? "ai"
              : "unknown",
        error,
      });
      console.error(
        `[Zoho Classify] Error classifying message ${messageId}: ${safeError.code}`,
      );
      const failureStatus = await scheduleFailure(
        emailRecord,
        safeError,
      );
      if (failureStatus === "stale_skip") skippedCount++;
      else failedCount++;
    }
  }

  console.log(
    `[Zoho Classify] Complete — checked: ${checkedCount}, classified: ${classifiedCount}, failed: ${failedCount}, review_required: ${reviewRequiredCount}`,
  );

  return { checked: checkedCount, classified: classifiedCount, failed: failedCount, skipped: skippedCount, review_required: reviewRequiredCount };
}
