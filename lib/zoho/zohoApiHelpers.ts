import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { randomUUID } from "crypto";

export interface ZohoConnectionForAuth {
  zoho_account_id: string;
  refresh_token: string;
}

interface FreshZohoConnection {
  access_token: string;
  access_token_expires_at: string;
  refresh_token: string;
}

const REFRESH_LOCK_KEY = "zoho_token_refresh";
const REFRESH_LOCK_STALE_MS = 2 * 60 * 1000;
const REFRESH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
let refreshCooldownUntilMs = 0;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

export function stripHtml(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function needsZohoTokenRefresh(expiresAtIso: string, nowMs = Date.now()): boolean {
  const expiresAt = new Date(expiresAtIso).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
}

async function readFreshConnection(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  zohoAccountId: string,
): Promise<FreshZohoConnection | null> {
  const { data, error } = await supabase
    .from("zoho_connections")
    .select("access_token,access_token_expires_at,refresh_token")
    .eq("zoho_account_id", zohoAccountId)
    .maybeSingle();

  if (error) throw new Error("Failed to query refreshed Zoho connection.");
  return (data as FreshZohoConnection | null) ?? null;
}

export async function refreshZohoToken(
  connection: ZohoConnectionForAuth,
  clientId: string,
  clientSecret: string,
  accountsBaseUrl: string,
): Promise<string> {
  if (Date.now() < refreshCooldownUntilMs) {
    throw new Error("Zoho token refresh cooling down.");
  }

  const supabase = createSupabaseServiceRoleClient();
  const ownerToken = randomUUID();
  const staleThreshold = new Date(Date.now() - REFRESH_LOCK_STALE_MS).toISOString();

  // ponytail: one tracker mailbox today; one global refresh lock is enough.
  await supabase
    .from("cron_locks")
    .delete()
    .eq("lock_key", REFRESH_LOCK_KEY)
    .lt("started_at", staleThreshold);

  const { error: lockError } = await supabase
    .from("cron_locks")
    .insert({
      lock_key: REFRESH_LOCK_KEY,
      started_at: new Date().toISOString(),
      owner_token: ownerToken,
    });

  if (lockError) {
    if (lockError.code === "23505") {
      const fresh = await readFreshConnection(supabase, connection.zoho_account_id);
      if (fresh && !needsZohoTokenRefresh(fresh.access_token_expires_at)) {
        return fresh.access_token;
      }
      throw new Error("Zoho token refresh already in progress.");
    }
    throw new Error("Failed to acquire Zoho token refresh lock.");
  }

  try {
    const fresh = await readFreshConnection(supabase, connection.zoho_account_id);
    if (fresh && !needsZohoTokenRefresh(fresh.access_token_expires_at)) {
      return fresh.access_token;
    }

    const tokenResponse = await fetch(`${accountsBaseUrl}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: connection.refresh_token,
      }).toString(),
    });

    const parsed: unknown = await tokenResponse.json();

    if (typeof parsed !== "object" || parsed === null) {
      refreshCooldownUntilMs = Date.now() + REFRESH_FAILURE_COOLDOWN_MS;
      throw new Error("Invalid response format from Zoho token endpoint.");
    }

    const tokenData = parsed as Record<string, unknown>;

    if (!tokenResponse.ok || tokenData.error) {
      refreshCooldownUntilMs = Date.now() + REFRESH_FAILURE_COOLDOWN_MS;
      throw new Error(
        `Zoho token refresh failed: ${String(tokenData.error ?? tokenResponse.status)}`,
      );
    }

    const newAccessToken =
      typeof tokenData.access_token === "string" && tokenData.access_token
        ? tokenData.access_token
        : null;
    const expiresIn = Number(tokenData.expires_in);

    if (!newAccessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      refreshCooldownUntilMs = Date.now() + REFRESH_FAILURE_COOLDOWN_MS;
      throw new Error("Zoho returned incomplete data during token refresh.");
    }

    const refreshTime = new Date();
    const newExpiresAt = new Date(refreshTime.getTime() + expiresIn * 1000);

    const { error: updateError } = await supabase
      .from("zoho_connections")
      .update({
        access_token: newAccessToken,
        access_token_expires_at: newExpiresAt.toISOString(),
        last_refresh_at: refreshTime.toISOString(),
        updated_at: refreshTime.toISOString(),
      })
      .eq("zoho_account_id", connection.zoho_account_id);

    if (updateError) {
      refreshCooldownUntilMs = Date.now() + REFRESH_FAILURE_COOLDOWN_MS;
      throw new Error("Failed to persist refreshed access token.");
    }

    refreshCooldownUntilMs = 0;
    return newAccessToken;
  } finally {
    await supabase
      .from("cron_locks")
      .delete()
      .eq("lock_key", REFRESH_LOCK_KEY)
      .eq("owner_token", ownerToken);
  }
}
