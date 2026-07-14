import "server-only";

import { hmacHex } from "@/lib/dashboardAuth/config";
import { normalizeEmail } from "@/lib/dashboardAuth/email";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

export interface RecordDashboardAuthAuditEventParams {
  userId?: string | null;
  email?: string | null;
  eventType: string;
  success: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

interface AuditInsertRow {
  user_id: string | null;
  email: string | null;
  event_type: string;
  success: boolean;
  ip_hash: string | null;
  user_agent_hash: string | null;
}

interface SupabaseLike {
  from(table: string): {
    insert(row: AuditInsertRow): Promise<{ error: { message: string } | null }>;
  };
}

export function hashSensitiveValue(value: string): string {
  return hmacHex(value);
}

export async function recordDashboardAuthAuditEvent(params: RecordDashboardAuthAuditEventParams): Promise<void> {
  try {
    const supabase = createSupabaseServiceRoleClient() as unknown as SupabaseLike;
    const row: AuditInsertRow = {
      user_id: params.userId ?? null,
      email: params.email ? normalizeEmail(params.email) : null,
      event_type: params.eventType,
      success: params.success,
      ip_hash: params.ip ? hashSensitiveValue(params.ip) : null,
      user_agent_hash: params.userAgent ? hashSensitiveValue(params.userAgent) : null,
    };

    await supabase.from("dashboard_auth_audit_events").insert(row);
  } catch {
    return;
  }
}
