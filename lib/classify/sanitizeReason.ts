import {
  DOUBLE_QUOTE_PATTERN,
  EMAIL_PATTERN,
  OTP_CODE_PATTERN,
  PASSWORD_MARKER_PATTERN,
  SECRET_MARKER_PATTERN,
  SINGLE_QUOTE_PATTERN,
  TOKEN_VALUE_PATTERN,
  URL_PATTERN,
  redactSensitivePatterns,
} from "./redactionPatterns";

const MAX_REASON_LENGTH = 96;
export const MAX_INPUT_REASON_LENGTH = 160;
const GENERIC_SAFE_REASON = "Classification reason redacted for safety.";

const RAW_OUTPUT_PATTERN = String.raw`\`\`\`|^\s*[{[]|content-type:|mime-version:|href=|<html|stack trace|traceback|raw response|provider output|exception:|response body|headers:`;

export const UNSAFE_REASON_SQL_PATTERN = [
  String.raw`https?://[^[:space:]]+`,
  String.raw`www\.[^[:space:]]+`,
  String.raw`[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`,
  String.raw`\m\d{4,8}\M`,
  String.raw`\m[A-Z0-9_-]{24,}\M`,
  String.raw`\m(?:password|passcode)\M`,
  String.raw`\m(?:api[-_ ]?key|access token|refresh token|bearer|authorization|client_secret|secret(?: key)?|private key)\M`,
  String.raw`"[^"\n]{8,}"`,
  String.raw`''[^''\n]{8,}''`,
  "```",
  String.raw`^\s*[{[]`,
  String.raw`content-type:`,
  String.raw`mime-version:`,
  String.raw`href=`,
  String.raw`<html`,
  String.raw`stack trace`,
  String.raw`traceback`,
  String.raw`raw response`,
  String.raw`provider output`,
  String.raw`exception:`,
  String.raw`response body`,
  String.raw`headers:`,
  String.raw`.{161,}`,
].join("|");

export const UNSAFE_REASON_DETECTION_RE = new RegExp(
  [
    URL_PATTERN,
    EMAIL_PATTERN,
    OTP_CODE_PATTERN,
    TOKEN_VALUE_PATTERN,
    PASSWORD_MARKER_PATTERN,
    SECRET_MARKER_PATTERN,
    DOUBLE_QUOTE_PATTERN,
    SINGLE_QUOTE_PATTERN,
    RAW_OUTPUT_PATTERN,
    String.raw`[\s\S]{161,}`,
  ].join("|"),
  "i",
);

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function reasonMatchesUnsafePolicy(reason: string | null | undefined): boolean {
  const trimmed = collapseWhitespace(reason ?? "");
  return Boolean(trimmed) && UNSAFE_REASON_DETECTION_RE.test(trimmed);
}

export function sanitizeReason(reason: string | null | undefined): string {
  const trimmed = collapseWhitespace(reason ?? "");

  if (!trimmed) {
    return "No classification reason provided.";
  }

  if (trimmed.length > MAX_INPUT_REASON_LENGTH) {
    return GENERIC_SAFE_REASON;
  }

  let safe = redactSensitivePatterns(trimmed);

  safe = collapseWhitespace(safe);

  if (reasonMatchesUnsafePolicy(safe)) {
    return GENERIC_SAFE_REASON;
  }

  if (safe.length > MAX_REASON_LENGTH) {
    safe = `${safe.slice(0, MAX_REASON_LENGTH - 1).trimEnd()}…`;
  }

  return safe || GENERIC_SAFE_REASON;
}

export const SAFE_REASON_FALLBACK = GENERIC_SAFE_REASON;
