import "server-only";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

export const TOTP_LOGIN_MAX_FAILURES = 5;
export const TOTP_SETUP_MAX_FAILURES = 5;
export const TOTP_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const OTP_REQUEST_MAX_SENDS = 3;
export const OTP_REQUEST_WINDOW_MS = 15 * 60 * 1000;

interface AuditCountRow {
  id: string;
}

interface AuditCountChain {
  eq(column: string, value: string | boolean): AuditCountChain;
  gte(column: string, value: string): AuditCountChain;
  then<TResult1 = { data: AuditCountRow[] | null; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: AuditCountRow[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface SupabaseLike {
  from(table: string): {
    select(columns: string): AuditCountChain;
  };
}

function thresholdIso(windowMs: number): string {
  return new Date(Date.now() - windowMs).toISOString();
}

export async function countRecentAuditEvents(params: {
  userId: string;
  eventType: string;
  onlyFailures?: boolean;
  windowMs: number;
}): Promise<number> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const query = supabase
      .from("dashboard_auth_audit_events")
      .select("id")
      .eq("user_id", params.userId)
      .eq("event_type", params.eventType)
      .gte("created_at", thresholdIso(params.windowMs));

    const filtered = params.onlyFailures ? query.eq("success", false) : query;
    const { data, error } = await filtered;
    if (error) throw new Error("audit count query failed");
    return Array.isArray(data) ? data.length : 0;
  } catch {
    throw new Error("audit count unavailable");
  }
}

async function isThrottled(params: {
  userId: string;
  eventType: string;
  onlyFailures?: boolean;
  windowMs: number;
  maxCount: number;
}): Promise<boolean> {
  try {
    const count = await countRecentAuditEvents({
      userId: params.userId,
      eventType: params.eventType,
      onlyFailures: params.onlyFailures,
      windowMs: params.windowMs,
    });
    return count >= params.maxCount;
  } catch {
    return true;
  }
}

export async function isDashboardTotpLoginThrottled(userId: string): Promise<boolean> {
  return isThrottled({
    userId,
    eventType: "login_totp_verify",
    onlyFailures: true,
    windowMs: TOTP_LOCKOUT_WINDOW_MS,
    maxCount: TOTP_LOGIN_MAX_FAILURES,
  });
}

export async function isDashboardTotpSetupThrottled(userId: string): Promise<boolean> {
  return isThrottled({
    userId,
    eventType: "totp_setup_completed",
    onlyFailures: true,
    windowMs: TOTP_LOCKOUT_WINDOW_MS,
    maxCount: TOTP_SETUP_MAX_FAILURES,
  });
}

export async function isDashboardLoginOtpRequestThrottled(userId: string): Promise<boolean> {
  return isThrottled({
    userId,
    eventType: "login_otp_requested",
    windowMs: OTP_REQUEST_WINDOW_MS,
    maxCount: OTP_REQUEST_MAX_SENDS,
  });
}
