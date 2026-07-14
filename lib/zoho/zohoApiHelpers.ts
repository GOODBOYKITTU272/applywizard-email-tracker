import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

export interface ZohoConnectionForAuth {
  zoho_account_id: string;
  refresh_token: string;
}

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

export async function refreshZohoToken(
  connection: ZohoConnectionForAuth,
  clientId: string,
  clientSecret: string,
  accountsBaseUrl: string,
): Promise<string> {
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
    throw new Error("Invalid response format from Zoho token endpoint.");
  }

  const tokenData = parsed as Record<string, unknown>;

  if (!tokenResponse.ok || tokenData.error) {
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
    throw new Error("Zoho returned incomplete data during token refresh.");
  }

  const supabase = createSupabaseServiceRoleClient();
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
    throw new Error("Failed to persist refreshed access token.");
  }

  return newAccessToken;
}
