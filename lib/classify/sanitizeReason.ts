const MAX_REASON_LENGTH = 96;
const GENERIC_SAFE_REASON = "Classification reason redacted for safety.";

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const OTP_CODE_RE = /\b\d{4,8}\b/g;
const TOKEN_RE = /\b[A-Za-z0-9_-]{24,}\b/g;
const DOUBLE_QUOTE_RE = /"[^"\n]{8,}"/g;
const SINGLE_QUOTE_RE = /'[^'\n]{8,}'/g;
const RAW_OUTPUT_RE =
  /```|^\s*[{[]|content-type:|mime-version:|href=|<html|stack trace|traceback|raw response|provider output|exception:/i;
const REMAINING_SUSPICIOUS_RE =
  /https?:\/\/|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{4,8}\b|\b[A-Za-z0-9_-]{24,}\b|```|content-type:|mime-version:|href=|<html/i;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function sanitizeReason(reason: string | null | undefined): string {
  const trimmed = collapseWhitespace(reason ?? "");

  if (!trimmed) {
    return "No classification reason provided.";
  }

  let safe = trimmed
    .replace(URL_RE, "[redacted-url]")
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(OTP_CODE_RE, "[redacted-code]")
    .replace(TOKEN_RE, "[redacted-token]")
    .replace(DOUBLE_QUOTE_RE, "[redacted-quote]")
    .replace(SINGLE_QUOTE_RE, "[redacted-quote]");

  safe = collapseWhitespace(safe);

  if (
    RAW_OUTPUT_RE.test(trimmed) ||
    REMAINING_SUSPICIOUS_RE.test(safe)
  ) {
    return GENERIC_SAFE_REASON;
  }

  if (safe.length > MAX_REASON_LENGTH) {
    safe = `${safe.slice(0, MAX_REASON_LENGTH - 1).trimEnd()}…`;
  }

  return safe || GENERIC_SAFE_REASON;
}

export const SAFE_REASON_FALLBACK = GENERIC_SAFE_REASON;
