// Pure helpers for the Live Monitor V1 controlled test-client seed. No secrets,
// no DB access, no network. The runner (scripts/live-monitor) does all I/O and
// only after these guards pass.

export const LIVE_MONITOR_TEST_CLIENT_MARKER = "live_monitor_v1_test_client";
export const LIVE_MONITOR_TEST_CLIENT_NAME = "Preview Test Client";
export const LIVE_MONITOR_TEST_CA_NAME = "Preview Test CA";
// Synthetic CA identity only — example.test is a reserved, non-deliverable domain.
export const LIVE_MONITOR_TEST_CA_EMAIL = "preview.ca@example.test";

const PREVIEW_REF = "obirkjbzpykoehxacaaj";
const PRODUCTION_REF = "nkkfsrhfttixwjbglhgg";

export function normalizeRecipient(value: string): string {
  return value.trim().toLowerCase();
}

function resolveRef(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  const match = url.trim().match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/);
  return match?.[1] ?? null;
}

// Every guard is checked before the runner creates a Supabase client or makes a call.
export function resolveLiveMonitorSeedGuard(
  env: NodeJS.ProcessEnv,
): { ok: true } | { ok: false; code: string } {
  if (env.SUPABASE_PROJECT_REF?.trim() !== PREVIEW_REF) {
    return { ok: false, code: "SUPABASE_PROJECT_REF_NOT_PREVIEW" };
  }
  const resolvedRef = resolveRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!resolvedRef) return { ok: false, code: "SUPABASE_URL_UNRESOLVED" };
  if (resolvedRef === PRODUCTION_REF) return { ok: false, code: "REFUSING_PRODUCTION" };
  if (resolvedRef !== PREVIEW_REF) return { ok: false, code: "SUPABASE_URL_NOT_PREVIEW" };
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return { ok: false, code: "MISSING_SERVICE_ROLE_KEY" };
  return { ok: true };
}

export function resolveTestClientConfig(
  env: NodeJS.ProcessEnv,
): { ok: true; recipient: string; normalizedRecipient: string } | { ok: false; code: string } {
  const recipient = env.LIVE_MONITOR_TEST_RECIPIENT?.trim() ?? "";
  if (!recipient) return { ok: false, code: "MISSING_RECIPIENT" };
  return { ok: true, recipient, normalizedRecipient: normalizeRecipient(recipient) };
}

// Insert payload. recipient_email_normalized is a generated column, so it is not
// set here — the DB derives it and it is the upsert conflict target.
export function buildTestClientRow(recipient: string): Record<string, unknown> {
  return {
    client_name: LIVE_MONITOR_TEST_CLIENT_NAME,
    recipient_email: recipient.trim(),
    assigned_ca_name: LIVE_MONITOR_TEST_CA_NAME,
    assigned_ca_email: LIVE_MONITOR_TEST_CA_EMAIL,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
}

// Cleanup is scoped to the exact synthetic identity AND the normalized recipient,
// so it can never remove an unrelated client.
export function buildTestClientCleanupFilter(
  normalizedRecipient: string,
): ReadonlyArray<{ column: string; value: string }> {
  return [
    { column: "recipient_email_normalized", value: normalizedRecipient },
    { column: "client_name", value: LIVE_MONITOR_TEST_CLIENT_NAME },
    { column: "assigned_ca_email", value: LIVE_MONITOR_TEST_CA_EMAIL },
  ];
}

export function redactRecipient(normalizedRecipient: string): string {
  const [local, domain] = normalizedRecipient.split("@");
  if (!domain) return "****";
  const head = local.slice(0, 2);
  return `${head}${local.length > 2 ? "***" : ""}@${domain}`;
}
