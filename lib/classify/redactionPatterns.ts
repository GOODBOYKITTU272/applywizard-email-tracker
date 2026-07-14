export const URL_PATTERN = String.raw`https?:\/\/\S+|www\.\S+`;
export const EMAIL_PATTERN = String.raw`[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`;
export const OTP_CODE_PATTERN = String.raw`\b\d{4,8}\b`;
export const TOKEN_VALUE_PATTERN = String.raw`\b[A-Za-z0-9_-]{24,}\b`;
export const PASSWORD_MARKER_PATTERN = String.raw`\b(?:password|passcode)\b`;
export const SECRET_MARKER_PATTERN = String.raw`\b(?:api[-_ ]?key|access token|refresh token|bearer|authorization|client_secret|secret(?: key)?|private key)\b`;
export const DOUBLE_QUOTE_PATTERN = String.raw`"[^"\n]{8,}"`;
export const SINGLE_QUOTE_PATTERN = String.raw`'[^'\n]{8,}'`;

const URL_RE = new RegExp(URL_PATTERN, "gi");
const EMAIL_RE = new RegExp(EMAIL_PATTERN, "gi");
const OTP_CODE_RE = new RegExp(OTP_CODE_PATTERN, "g");
const TOKEN_RE = new RegExp(TOKEN_VALUE_PATTERN, "g");
const PASSWORD_MARKER_RE = new RegExp(PASSWORD_MARKER_PATTERN, "gi");
const SECRET_MARKER_RE = new RegExp(SECRET_MARKER_PATTERN, "gi");
const DOUBLE_QUOTE_RE = new RegExp(DOUBLE_QUOTE_PATTERN, "g");
const SINGLE_QUOTE_RE = new RegExp(SINGLE_QUOTE_PATTERN, "g");

export function redactSensitivePatterns(text: string): string {
  return text
    .replace(URL_RE, "[redacted-url]")
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(OTP_CODE_RE, "[redacted-code]")
    .replace(TOKEN_RE, "[redacted-token]")
    .replace(PASSWORD_MARKER_RE, "[redacted-marker]")
    .replace(SECRET_MARKER_RE, "[redacted-marker]")
    .replace(DOUBLE_QUOTE_RE, "[redacted-quote]")
    .replace(SINGLE_QUOTE_RE, "[redacted-quote]");
}
