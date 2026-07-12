export type PreviewAdminToolErrorCode =
  | "INVALID_TARGET"
  | "MISSING_EMAIL"
  | "MISSING_PROJECT_REF"
  | "MALFORMED_PROJECT_REF"
  | "MISSING_SUPABASE_URL"
  | "MALFORMED_SUPABASE_URL"
  | "PROJECT_REF_MISMATCH"
  | "PRODUCTION_PROJECT_REF"
  | "DB_READ_FAILED"
  | "DB_WRITE_FAILED"
  | "REVOKE_FAILED";

export type PreviewAdminToolResult =
  | {
      ok: true;
      mode: "seed";
      action: "created" | "updated" | "would_create" | "would_update";
      normalizedEmail: string;
      projectRef: string;
    }
  | {
      ok: true;
      mode: "disable";
      action: "disabled" | "already_disabled" | "missing";
      normalizedEmail: string;
      projectRef: string;
    }
  | { ok: false; code: PreviewAdminToolErrorCode };

type QueryResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;
type Row = Record<string, unknown>;

export interface PreviewAdminSupabase {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): QueryResult<Row>;
      };
    };
    insert(row: Row): {
      select(columns: string): {
        single(): QueryResult<{ id: string }>;
      };
    };
    update(row: Row): {
      eq(column: string, value: string): {
        select(columns: string): {
          maybeSingle(): QueryResult<{ id: string }>;
        };
      };
    };
  };
}

export interface PreviewAdminLogger {
  info(message: string): void;
  error(message: string): void;
}

type RevokeAllSessionsForUser = (userId: string) => Promise<{ ok: true } | { ok: false }>;

interface PreviewAdminParams {
  env: NodeJS.ProcessEnv;
  supabase: PreviewAdminSupabase;
  logger?: PreviewAdminLogger;
}

interface DisablePreviewAdminParams extends PreviewAdminParams {
  revokeAllSessionsForUser: RevokeAllSessionsForUser;
}

interface ValidatedConfig {
  normalizedEmail: string;
  projectRef: string;
}

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const USER_COLUMNS = "id, email, email_normalized, role, status, totp_enabled";

export function normalizePreviewAdminEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function sanitizeProjectRef(projectRef: string): string {
  if (projectRef.length <= 8) return "****";
  return `${projectRef.slice(0, 4)}...${projectRef.slice(-4)}`;
}

export function resolveSupabaseProjectRef(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl?.trim()) return null;

  try {
    const parsed = new URL(supabaseUrl);
    const match = parsed.hostname.match(/^([a-z0-9]{20})\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function validatePreviewConfig(env: NodeJS.ProcessEnv): { ok: true; config: ValidatedConfig } | { ok: false; code: PreviewAdminToolErrorCode } {
  if (env.DASHBOARD_AUTH_SEED_TARGET !== "preview") return { ok: false, code: "INVALID_TARGET" };

  const normalizedEmail = normalizePreviewAdminEmail(env.DASHBOARD_TEST_ADMIN_EMAIL ?? "");
  if (!normalizedEmail) return { ok: false, code: "MISSING_EMAIL" };

  const expectedRef = env.DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF?.trim() ?? "";
  if (!expectedRef) return { ok: false, code: "MISSING_PROJECT_REF" };
  if (!PROJECT_REF_PATTERN.test(expectedRef)) return { ok: false, code: "MALFORMED_PROJECT_REF" };

  const resolvedRef = resolveSupabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.trim()) return { ok: false, code: "MISSING_SUPABASE_URL" };
  if (!resolvedRef) return { ok: false, code: "MALFORMED_SUPABASE_URL" };

  const productionRef = env.DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF?.trim() ?? "";
  if (productionRef && (!PROJECT_REF_PATTERN.test(productionRef) || expectedRef === productionRef || resolvedRef === productionRef)) {
    return { ok: false, code: "PRODUCTION_PROJECT_REF" };
  }

  if (resolvedRef !== expectedRef) return { ok: false, code: "PROJECT_REF_MISMATCH" };

  return { ok: true, config: { normalizedEmail, projectRef: expectedRef } };
}

async function findUserByEmail(supabase: PreviewAdminSupabase, normalizedEmail: string): QueryResult<Row> {
  return supabase
    .from("dashboard_users")
    .select(USER_COLUMNS)
    .eq("email_normalized", normalizedEmail)
    .maybeSingle();
}

function logSuccess(
  logger: PreviewAdminLogger | undefined,
  result: Extract<PreviewAdminToolResult, { ok: true }>,
): void {
  logger?.info(
    [
      `mode=${result.mode}`,
      `action=${result.action}`,
      `normalized_email=${result.normalizedEmail}`,
      `preview_project_ref=${sanitizeProjectRef(result.projectRef)}`,
    ].join(" "),
  );
}

export async function seedPreviewAdmin(
  params: PreviewAdminParams & { dryRun?: boolean },
): Promise<PreviewAdminToolResult> {
  const validated = validatePreviewConfig(params.env);
  if (!validated.ok) return validated;

  const { normalizedEmail, projectRef } = validated.config;
  const existing = await findUserByEmail(params.supabase, normalizedEmail);
  if (existing.error) return { ok: false, code: "DB_READ_FAILED" };

  if (params.dryRun) {
    const result: PreviewAdminToolResult = {
      ok: true,
      mode: "seed",
      action: existing.data ? "would_update" : "would_create",
      normalizedEmail,
      projectRef,
    };
    logSuccess(params.logger, result);
    return result;
  }

  const row = {
    email: normalizedEmail,
    role: "admin_ceo",
    status: "active",
    totp_enabled: false,
    totp_secret_encrypted: null,
  };

  if (existing.data) {
    const updated = await params.supabase
      .from("dashboard_users")
      .update(row)
      .eq("email_normalized", normalizedEmail)
      .select("id")
      .maybeSingle();

    if (updated.error || !updated.data) return { ok: false, code: "DB_WRITE_FAILED" };
    const result: PreviewAdminToolResult = { ok: true, mode: "seed", action: "updated", normalizedEmail, projectRef };
    logSuccess(params.logger, result);
    return result;
  }

  const inserted = await params.supabase.from("dashboard_users").insert(row).select("id").single();
  if (inserted.error || !inserted.data) return { ok: false, code: "DB_WRITE_FAILED" };

  const result: PreviewAdminToolResult = { ok: true, mode: "seed", action: "created", normalizedEmail, projectRef };
  logSuccess(params.logger, result);
  return result;
}

export async function disablePreviewAdmin(params: DisablePreviewAdminParams): Promise<PreviewAdminToolResult> {
  const validated = validatePreviewConfig(params.env);
  if (!validated.ok) return validated;

  const { normalizedEmail, projectRef } = validated.config;
  const existing = await findUserByEmail(params.supabase, normalizedEmail);
  if (existing.error) return { ok: false, code: "DB_READ_FAILED" };

  if (!existing.data) {
    const result: PreviewAdminToolResult = { ok: true, mode: "disable", action: "missing", normalizedEmail, projectRef };
    logSuccess(params.logger, result);
    return result;
  }

  const userId = String(existing.data.id ?? "");
  if (!userId) return { ok: false, code: "DB_READ_FAILED" };

  let action: "disabled" | "already_disabled" = "already_disabled";
  if (existing.data.status !== "disabled") {
    const updated = await params.supabase
      .from("dashboard_users")
      .update({ status: "disabled" })
      .eq("email_normalized", normalizedEmail)
      .select("id")
      .maybeSingle();

    if (updated.error || !updated.data) return { ok: false, code: "DB_WRITE_FAILED" };
    action = "disabled";
  }

  const revoked = await params.revokeAllSessionsForUser(userId);
  if (!revoked.ok) return { ok: false, code: "REVOKE_FAILED" };

  const result: PreviewAdminToolResult = { ok: true, mode: "disable", action, normalizedEmail, projectRef };
  logSuccess(params.logger, result);
  return result;
}
