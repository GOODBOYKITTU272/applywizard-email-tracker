/**
 * extractRecipient — deterministic original-recipient extraction.
 *
 * Pure function: no network access, no database access, no side effects.
 * Safe output: never returns raw header content, never exposes full sender email.
 *
 * Architecture: forwarded emails arrive in the central tracker mailbox with
 * original recipient information preserved in SMTP headers. This module
 * extracts the original @applywizard.ai client mailbox from those headers.
 */

export interface RecipientExtractionInput {
  /** Raw SMTP header block from Zoho header API. Used only in memory; never stored or logged. */
  rawHeaders: string;
  toAddress: string;
  ccAddress: string;
  fromAddress: string;
  /** The tracker mailbox address (e.g. tracker@applywizard.ai) — excluded from candidates. */
  trackerMailbox: string;
}

export interface RecipientExtractionResult {
  originalRecipient: string | null;
  direction: "incoming" | "outgoing" | null;
  routingConfidence: "single" | "multi_candidate" | "fallback" | null;
  routingStatus: "routed" | "unroutable" | "internal";
  /** Safe reason code only — never contains raw header values. */
  reasonCode: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const CLIENT_DOMAIN = "@applywizard.ai";
// ponytail: simple RFC-5322-subset match; upgrade to a proper parser if edge cases accumulate.
const EMAIL_RE = /[\w.+\-']+@[\w.\-]+\.[a-z]{2,}/gi;

function extractEmails(value: string): string[] {
  return [...value.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase());
}

/**
 * Parse a raw SMTP header block into a Map of lowercased header name → array of values.
 * Handles folded headers (lines starting with whitespace continue the previous header).
 * The raw content is never stored or returned in any output.
 */
function parseHeaders(raw: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const lines = raw.split(/\r?\n/);
  let key = "";
  let val = "";

  const flush = () => {
    if (!key) return;
    const k = key.toLowerCase();
    const existing = map.get(k) ?? [];
    existing.push(val.trim());
    map.set(k, existing);
  };

  for (const line of lines) {
    if (/^\s/.test(line) && key) {
      val += " " + line.trim();
    } else {
      flush();
      const colon = line.indexOf(":");
      if (colon > 0) {
        key = line.slice(0, colon).trim();
        val = line.slice(colon + 1);
      } else {
        key = "";
        val = "";
      }
    }
  }
  flush();
  return map;
}

function isClientMailbox(email: string, tracker: string): boolean {
  return email.endsWith(CLIENT_DOMAIN) && email !== tracker;
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Extract the original recipient client mailbox from a forwarded email.
 *
 * Header priority order (Delivered-To checked first, Cc last):
 *   1. Delivered-To
 *   2. X-Original-To
 *   3. Original-Recipient
 *   4. X-Forwarded-To
 *   5. To (from /details response)
 *   6. Cc (from /details response)
 */
export function extractOriginalRecipient(
  input: RecipientExtractionInput,
): RecipientExtractionResult {
  const tracker = input.trackerMailbox.toLowerCase().trim();
  const fromAddr = extractEmails(input.fromAddress)[0] ?? null;

  // ── Outgoing detection ─────────────────────────────────────────────────────
  // If the sender is a client mailbox (not tracker, is @applywizard.ai) this is
  // a copy of an outgoing email. Map originalRecipient to the client sender.
  if (fromAddr && isClientMailbox(fromAddr, tracker)) {
    // Check whether ALL recipients are also internal (→ internal, not outgoing)
    const allRecipients = [
      ...extractEmails(input.toAddress),
      ...extractEmails(input.ccAddress),
    ];
    const hasExternalRecipient = allRecipients.some(
      (e) => !e.endsWith(CLIENT_DOMAIN),
    );
    if (hasExternalRecipient) {
      return {
        originalRecipient: fromAddr,
        direction: "outgoing",
        routingConfidence: "single",
        routingStatus: "routed",
        reasonCode: "outgoing_from_client_sender",
      };
    }
    // All @applywizard.ai → internal
    return {
      originalRecipient: null,
      direction: null,
      routingConfidence: null,
      routingStatus: "internal",
      reasonCode: "internal_all_applywizard",
    };
  }

  // ── Incoming: extract original recipient from headers ──────────────────────
  const headers = parseHeaders(input.rawHeaders);

  // Header priority list (name → header key)
  const priorityHeaders = [
    "delivered-to",
    "x-original-to",
    "original-recipient",
    "x-forwarded-to",
  ];

  const candidates: string[] = [];

  for (const headerKey of priorityHeaders) {
    const values = headers.get(headerKey) ?? [];
    for (const v of values) {
      for (const email of extractEmails(v)) {
        if (isClientMailbox(email, tracker) && !candidates.includes(email)) {
          candidates.push(email);
        }
      }
    }
  }

  // Fallback: check To / Cc from /details response
  let usedFallback = false;
  if (candidates.length === 0) {
    const toEmails = extractEmails(input.toAddress).filter((e) =>
      isClientMailbox(e, tracker),
    );
    const ccEmails = extractEmails(input.ccAddress).filter((e) =>
      isClientMailbox(e, tracker),
    );
    for (const e of [...toEmails, ...ccEmails]) {
      if (!candidates.includes(e)) candidates.push(e);
    }
    if (candidates.length > 0) usedFallback = true;
  }

  if (candidates.length === 0) {
    return {
      originalRecipient: null,
      direction: null,
      routingConfidence: null,
      routingStatus: "unroutable",
      reasonCode: "unroutable_no_client_candidate",
    };
  }

  const chosen = candidates[0];
  const confidence =
    candidates.length > 1
      ? "multi_candidate"
      : usedFallback
        ? "fallback"
        : "single";

  return {
    originalRecipient: chosen,
    direction: "incoming",
    routingConfidence: confidence,
    routingStatus: "routed",
    reasonCode:
      candidates.length > 1
        ? "multi_candidate_first_used"
        : usedFallback
          ? "matched_to_cc_fallback"
          : "matched_priority_header",
  };
}
