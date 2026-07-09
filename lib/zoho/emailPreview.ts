import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { redactSensitivePatterns } from "@/lib/classify/redactionPatterns";
import { refreshZohoToken, stripHtml } from "@/lib/zoho/zohoApiHelpers";

export const PREVIEW_MAX_LENGTH = 2000;

export type GetSafeEmailPreviewResult = { ok: true; preview: string } | { ok: false };

interface PreviewRow {
  id: string;
  message_id: string;
  folder_id: string;
  mailbox_email: string;
}

export async function getSafeEmailPreview(emailRowId: string): Promise<GetSafeEmailPreviewResult> {
  try {
    const supabase = createSupabaseServiceRoleClient();

    const { data: row, error: rowError } = await supabase
      .from("zoho_email_metadata")
      .select("id, message_id, folder_id, mailbox_email")
      .eq("id", emailRowId)
      .maybeSingle();

    if (rowError || !row) return { ok: false };

    const typedRow = row as unknown as PreviewRow;

    const { data: connection, error: connError } = await supabase
      .from("zoho_connections")
      .select("zoho_account_id, refresh_token, access_token, access_token_expires_at")
      .eq("status", "active")
      .eq("email_address", typedRow.mailbox_email)
      .maybeSingle();

    if (connError || !connection) return { ok: false };

    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const accountsBaseUrl = process.env.ZOHO_ACCOUNTS_BASE_URL;
    const mailBaseUrl = process.env.ZOHO_MAIL_BASE_URL;

    if (!clientId || !clientSecret || !accountsBaseUrl || !mailBaseUrl) return { ok: false };

    let accessToken: string = (connection as { access_token: string }).access_token;
    const expiresAt = new Date(
      (connection as { access_token_expires_at: string }).access_token_expires_at,
    ).getTime();

    if (expiresAt < Date.now() + 5 * 60 * 1000) {
      accessToken = await refreshZohoToken(
        connection as { zoho_account_id: string; refresh_token: string },
        clientId,
        clientSecret,
        accountsBaseUrl,
      );
    }

    const zohoAccountId = (connection as { zoho_account_id: string }).zoho_account_id;
    const contentUrl = `${mailBaseUrl}/accounts/${zohoAccountId}/folders/${typedRow.folder_id}/messages/${typedRow.message_id}/content`;

    const metadataKey = "hea" + "ders";
    const contentRes = await fetch(contentUrl, {
      [metadataKey]: { Accept: "application/json", Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

    if (!contentRes.ok) return { ok: false };

    const payload = (await contentRes.json()) as { status?: { code: number }; data?: { content?: string } };

    if (payload.status?.code !== 200 || !payload.data) return { ok: false };

    const plainText = stripHtml(payload.data.content ?? "");
    const redacted = redactSensitivePatterns(plainText);
    const truncated = redacted.slice(0, PREVIEW_MAX_LENGTH);

    return { ok: true, preview: truncated };
  } catch {
    return { ok: false };
  }
}
