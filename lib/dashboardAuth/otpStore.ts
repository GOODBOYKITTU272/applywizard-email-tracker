import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { hashOtp, verifyOtp } from "@/lib/dashboardAuth/otp";

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

type CreateDashboardEmailOtpResult = { ok: true; otpId: string; expiresAt: string } | { ok: false };
type VerifyDashboardEmailOtpFailureReason =
  | "not_found"
  | "expired"
  | "used"
  | "too_many_attempts"
  | "incorrect"
  | "query_error";
type VerifyDashboardEmailOtpResult =
  | { ok: true; userId: string }
  | { ok: false; reason: VerifyDashboardEmailOtpFailureReason };

interface OtpRow {
  id: string;
  user_id: string;
  otp_hash: string;
  expires_at: string;
  used_at: string | null;
  attempt_count: number;
}

interface SelectChain {
  eq(column: string, value: string): SelectChain;
  is(column: string, value: null): SelectChain;
  gt(column: string, value: string): SelectChain;
  order(column: string, options?: { ascending?: boolean }): SelectChain;
  limit(n: number): SelectChain;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
}

interface FilterChain extends PromiseLike<{ error: { message: string } | null }> {
  eq(column: string, value: string): FilterChain;
  is(column: string, value: null): FilterChain;
  select(columns: string): {
    maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  };
}

interface SupabaseLike {
  from(table: string): {
    select(columns: string): SelectChain;
    insert(row: Record<string, unknown>): {
      select(columns: string): {
        single(): Promise<{ data: { id: string; expires_at: string } | null; error: { message: string } | null }>;
      };
    };
    update(payload: Record<string, unknown>): FilterChain;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function otpExpiresAt(): string {
  return new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
}

function getOtpFailureReason(row: OtpRow): VerifyDashboardEmailOtpFailureReason | null {
  if (row.used_at) return "used";
  const expiresAtMs = new Date(row.expires_at).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) return "expired";
  if (row.attempt_count >= MAX_OTP_ATTEMPTS) return "too_many_attempts";
  return null;
}

async function findOtpById(
  supabase: SupabaseLike,
  otpId: string,
): Promise<{ ok: true; row: OtpRow | null } | { ok: false }> {
  const { data, error } = await supabase
    .from("dashboard_email_otps")
    .select("id, user_id, otp_hash, expires_at, used_at, attempt_count")
    .eq("id", otpId)
    .maybeSingle();

  if (error) return { ok: false };
  return { ok: true, row: data ? (data as unknown as OtpRow) : null };
}

async function incrementAttemptCount(supabase: SupabaseLike, row: OtpRow): Promise<boolean> {
  const { data, error } = await supabase
    .from("dashboard_email_otps")
    .update({ attempt_count: row.attempt_count + 1 })
    .eq("id", row.id)
    .eq("attempt_count", String(row.attempt_count))
    .is("used_at", null)
      .select("id")
      .maybeSingle();

  return !error && !!data;
}

export async function createDashboardEmailOtp(params: {
  userId: string;
  rawOtp: string;
}): Promise<CreateDashboardEmailOtpResult> {
  try {
    const expiresAt = otpExpiresAt();
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { data, error } = await supabase
      .from("dashboard_email_otps")
      .insert({
        user_id: params.userId,
        otp_hash: hashOtp(params.rawOtp),
        expires_at: expiresAt,
        attempt_count: 0,
      })
      .select("id, expires_at")
      .single();

    if (error || !data) return { ok: false };
    return { ok: true, otpId: data.id, expiresAt: data.expires_at };
  } catch {
    return { ok: false };
  }
}

export async function verifyDashboardEmailOtp(params: {
  otpId: string;
  rawOtp: string;
}): Promise<{ ok: true; userId: string } | VerifyDashboardEmailOtpResult> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const lookup = await findOtpById(supabase, params.otpId);
    if (!lookup.ok) return { ok: false, reason: "query_error" };
    if (!lookup.row) return { ok: false, reason: "not_found" };

    const row = lookup.row;
    const failureReason = getOtpFailureReason(row);
    if (failureReason) return { ok: false, reason: failureReason };

    if (!verifyOtp(params.rawOtp, row.otp_hash)) {
      const incremented = await incrementAttemptCount(supabase, row);
      return incremented ? { ok: false, reason: "incorrect" } : { ok: false, reason: "query_error" };
    }

    const { data, error } = await supabase
      .from("dashboard_email_otps")
      .update({ used_at: nowIso() })
      .eq("id", row.id)
      .is("used_at", null)
      .select("id")
      .maybeSingle();

    if (error || !data) return { ok: false, reason: "query_error" };
    return { ok: true, userId: row.user_id };
  } catch {
    return { ok: false, reason: "query_error" };
  }
}

export async function getLatestUsableDashboardEmailOtp(
  userId: string,
): Promise<{ ok: true; challengeId: string; expiresAt: string } | { ok: false }> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { data, error } = await supabase
      .from("dashboard_email_otps")
      .select("id, expires_at")
      .eq("user_id", userId)
      .is("used_at", null)
      .eq("attempt_count", "0")
      .gt("expires_at", nowIso())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return { ok: false };
    return { ok: true, challengeId: data.id as string, expiresAt: data.expires_at as string };
  } catch {
    return { ok: false };
  }
}

export async function invalidateDashboardEmailOtp(otpId: string): Promise<{ ok: true } | { ok: false }> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const { error } = await supabase
      .from("dashboard_email_otps")
      .update({ used_at: nowIso() })
      .eq("id", otpId)
      .is("used_at", null);
    return error ? { ok: false } : { ok: true };
  } catch {
    return { ok: false };
  }
}
