import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { normalizeEmail } from "@/lib/dashboardAuth/email";
import { resolveAutoProvisionRole } from "@/lib/dashboardAuth/roles";

export type DashboardRole = "admin_ceo" | "manager_ops" | "ca";
export type DashboardUserStatus = "active" | "disabled";

export interface DashboardUser {
  id: string;
  email: string;
  role: DashboardRole;
  status: DashboardUserStatus;
  totpEnabled: boolean;
}

export interface DashboardUserAuthRecord extends DashboardUser {
  totpSecretEncrypted: string | null;
}

interface DashboardUserRow {
  id: string;
  email: string;
  role: DashboardRole;
  status: DashboardUserStatus;
  totp_enabled: boolean;
}

interface DashboardUserAuthRow extends DashboardUserRow {
  totp_secret_encrypted: string | null;
}

interface SelectChain {
  eq(column: string, value: string): {
    maybeSingle(): Promise<{ data: DashboardUserRow | DashboardUserAuthRow | null; error: { message: string } | null }>;
  };
}

interface UpdateChain {
  eq(column: string, value: string): {
    select(columns: string): {
      maybeSingle(): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
    };
  };
}

interface InsertChain {
  select(columns: string): {
    maybeSingle(): Promise<{ data: DashboardUserRow | null; error: { code?: string; message: string } | null }>;
  };
}

interface SupabaseLike {
  from(table: string): {
    select(columns: string): SelectChain;
    update(payload: Record<string, unknown>): UpdateChain;
    insert(payload: Record<string, unknown>): InsertChain;
  };
}

function mapUserRow(row: DashboardUserRow): DashboardUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    totpEnabled: row.totp_enabled,
  };
}

function mapUserAuthRow(row: DashboardUserAuthRow): DashboardUserAuthRecord {
  return {
    ...mapUserRow(row),
    totpSecretEncrypted: row.totp_secret_encrypted,
  };
}

async function getDashboardUserRowByColumn(
  column: "email_normalized" | "id",
  value: string,
  columns: string,
): Promise<DashboardUserRow | null> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { data, error } = await supabase.from("dashboard_users").select(columns).eq(column, value).maybeSingle();

    if (error || !data) return null;
    return data as DashboardUserRow;
  } catch {
    return null;
  }
}

async function getDashboardUserAuthRowById(userId: string): Promise<DashboardUserAuthRow | null> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { data, error } = await supabase
      .from("dashboard_users")
      .select("id, email, role, status, totp_enabled, totp_secret_encrypted")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) return null;
    return data as DashboardUserAuthRow;
  } catch {
    return null;
  }
}

export async function getDashboardUserByEmail(email: string): Promise<DashboardUser | null> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  const row = await getDashboardUserRowByColumn(
    "email_normalized",
    normalizedEmail,
    "id, email, role, status, totp_enabled",
  );
  return row ? mapUserRow(row) : null;
}

export async function getDashboardUserById(userId: string): Promise<DashboardUser | null> {
  if (!userId.trim()) return null;

  const row = await getDashboardUserRowByColumn("id", userId, "id, email, role, status, totp_enabled");
  return row ? mapUserRow(row) : null;
}

export async function getDashboardUserAuthRecordById(userId: string): Promise<DashboardUserAuthRecord | null> {
  if (!userId.trim()) return null;

  const row = await getDashboardUserAuthRowById(userId);
  return row ? mapUserAuthRow(row) : null;
}

export async function setDashboardUserTotpSecret(params: {
  userId: string;
  encryptedSecret: string;
}): Promise<{ ok: true } | { ok: false }> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { data, error } = await supabase
      .from("dashboard_users")
      .update({
        totp_secret_encrypted: params.encryptedSecret,
        totp_enabled: true,
      })
      .eq("id", params.userId)
      .select("id")
      .maybeSingle();

    if (error || !data) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export type DashboardUserForLoginResult =
  | { user: DashboardUser; created: boolean }
  | null;

/**
 * Returns the existing dashboard user for this email, or auto-creates one
 * for an eligible @applywizz.ai address. The email policy is checked before
 * any existing-row lookup, so a pre-existing row with a now-blocked email
 * (external domain, alias, lookalike domain) cannot log in. Never changes
 * the role or status of an existing row — auto-provisioning only ever
 * fires when no row exists.
 */
export async function getOrCreateDashboardUserForLogin(email: string): Promise<DashboardUserForLoginResult> {
  const decision = resolveAutoProvisionRole(email);
  if (!decision.eligible) return null;

  const existing = await getDashboardUserByEmail(decision.email);
  if (existing) return { user: existing, created: false };

  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { data, error } = await supabase
      .from("dashboard_users")
      .insert({ email: decision.email, role: decision.role, status: "active" })
      .select("id, email, role, status, totp_enabled")
      .maybeSingle();

    if (!error && data) return { user: mapUserRow(data), created: true };

    // Two logins racing to create the same email hit the unique constraint —
    // the loser re-fetches the winner's row instead of failing the login.
    if (error?.code === "23505") {
      const racedUser = await getDashboardUserByEmail(decision.email);
      return racedUser ? { user: racedUser, created: false } : null;
    }

    return null;
  } catch {
    return null;
  }
}
