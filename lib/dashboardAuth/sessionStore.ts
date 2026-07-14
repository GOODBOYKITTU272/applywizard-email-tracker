import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { hashSessionToken } from "@/lib/dashboardAuth/session";
import type { DashboardRole, DashboardUserStatus } from "@/lib/dashboardAuth/users";

export interface DashboardSessionUser {
  id: string;
  email: string;
  role: DashboardRole;
  status: DashboardUserStatus;
  totpEnabled: boolean;
}

export interface DashboardSession {
  id: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  user: DashboardSessionUser;
}

export type CreateDashboardSessionResult = { ok: true; sessionId: string } | { ok: false };
export type GetDashboardSessionResult = { ok: true; session: DashboardSession } | { ok: false };
export type RevokeDashboardSessionResult = { ok: true } | { ok: false };

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
}

interface UserRow {
  id: string;
  email: string;
  role: DashboardRole;
  status: DashboardUserStatus;
  totp_enabled: boolean;
}

interface FilterChain extends PromiseLike<{ error: { message: string } | null }> {
  eq(column: string, value: string): FilterChain;
  is(column: string, value: null): FilterChain;
}

interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
    insert(row: Record<string, unknown>): {
      select(columns: string): {
        single(): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
    update(payload: Record<string, unknown>): FilterChain;
  };
}

export function isDashboardSessionUsable(input: {
  expiresAt: string;
  revokedAt: string | null;
  userStatus: DashboardUserStatus;
}): boolean {
  if (input.revokedAt) return false;
  if (input.userStatus !== "active") return false;

  const expiresAtMs = new Date(input.expiresAt).getTime();
  return !Number.isNaN(expiresAtMs) && expiresAtMs > Date.now();
}

async function touchLastSeen(supabase: SupabaseLike, sessionId: string): Promise<void> {
  try {
    await supabase
      .from("dashboard_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", sessionId);
  } catch {
    // best-effort only; a failed touch must never invalidate an otherwise-valid session
  }
}

export async function createDashboardSession(params: {
  userId: string;
  rawToken: string;
  expiresAt: Date;
}): Promise<CreateDashboardSessionResult> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { data, error } = await supabase
      .from("dashboard_sessions")
      .insert({
        user_id: params.userId,
        session_hash: hashSessionToken(params.rawToken),
        expires_at: params.expiresAt.toISOString(),
        last_seen_at: null,
      })
      .select("id")
      .single();

    if (error || !data) return { ok: false };
    return { ok: true, sessionId: data.id };
  } catch {
    return { ok: false };
  }
}

export async function getDashboardSessionByToken(rawToken: string): Promise<GetDashboardSessionResult> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const sessionHash = hashSessionToken(rawToken);

    const { data: sessionData, error: sessionError } = await supabase
      .from("dashboard_sessions")
      .select("id, user_id, expires_at, revoked_at")
      .eq("session_hash", sessionHash)
      .maybeSingle();

    if (sessionError || !sessionData) return { ok: false };
    const session = sessionData as unknown as SessionRow;

    const { data: userData, error: userError } = await supabase
      .from("dashboard_users")
      .select("id, email, role, status, totp_enabled")
      .eq("id", session.user_id)
      .maybeSingle();

    if (userError || !userData) return { ok: false };
    const user = userData as unknown as UserRow;

    if (
      !isDashboardSessionUsable({
        expiresAt: session.expires_at,
        revokedAt: session.revoked_at,
        userStatus: user.status,
      })
    ) {
      return { ok: false };
    }

    await touchLastSeen(supabase, session.id);

    return {
      ok: true,
      session: {
        id: session.id,
        userId: session.user_id,
        expiresAt: session.expires_at,
        revokedAt: session.revoked_at,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          status: user.status,
          totpEnabled: user.totp_enabled,
        },
      },
    };
  } catch {
    return { ok: false };
  }
}

export async function revokeDashboardSession(rawToken: string): Promise<RevokeDashboardSessionResult> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { error } = await supabase
      .from("dashboard_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("session_hash", hashSessionToken(rawToken))
      .is("revoked_at", null);

    return error ? { ok: false } : { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function revokeDashboardSessionsForUser(userId: string): Promise<RevokeDashboardSessionResult> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { error } = await supabase
      .from("dashboard_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("revoked_at", null);

    return error ? { ok: false } : { ok: true };
  } catch {
    return { ok: false };
  }
}
