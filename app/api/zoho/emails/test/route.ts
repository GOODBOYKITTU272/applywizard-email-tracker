import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface ZohoEmailItem {
  messageId: string;
  sender: string;
  fromAddress?: string;
  subject: string;
  receivedTime: string | number;
  folderName?: string;
  folderId?: string;
}

export async function GET() {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const accountsBaseUrl = process.env.ZOHO_ACCOUNTS_BASE_URL;
  const mailBaseUrl = process.env.ZOHO_MAIL_BASE_URL;

  if (!clientId || !clientSecret || !accountsBaseUrl || !mailBaseUrl) {
    console.error("[Zoho Mail Test] Missing required Zoho API configuration env vars.");
    return NextResponse.json(
      { error: "Zoho API configuration is incomplete on the server." },
      { status: 500 },
    );
  }

  const supabase = createSupabaseServerClient();
  const trackerMailbox = process.env.ZOHO_SYNC_MAILBOX?.toLowerCase().trim();

  if (!trackerMailbox) {
    return NextResponse.json(
      { error: "ZOHO_SYNC_MAILBOX is not configured on the server." },
      { status: 500 },
    );
  }

  // Find the active tracker-mailbox connection only
  const { data: connection, error: connError } = await supabase
    .from("zoho_connections")
    .select("*")
    .eq("status", "active")
    .eq("email_address", trackerMailbox)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connError) {
    console.error("[Zoho Mail Test] Failed to query zoho_connections:", connError.message);
    return NextResponse.json(
      { error: "Failed to retrieve connection from database." },
      { status: 500 },
    );
  }

  if (!connection) {
    return NextResponse.json(
      { error: "No active Zoho connection found. Please log in first." },
      { status: 404 },
    );
  }

  if (connection.email_address !== trackerMailbox) {
    return NextResponse.json(
      { error: "Tracker mailbox connection mismatch." },
      { status: 404 },
    );
  }

  let accessToken = connection.access_token;
  const expiresAt = new Date(connection.access_token_expires_at).getTime();
  const now = Date.now();
  const bufferTime = 5 * 60 * 1000; // 5 minute buffer

  let tokenRefreshed = false;

  if (expiresAt < now + bufferTime) {
    console.log(`[Zoho Mail Test] Access token expired or near expiry (expires at: ${connection.access_token_expires_at}). Refreshing...`);

    try {
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
        console.error(
          "[Zoho Mail Test] Token refresh failed:",
          tokenData.error || tokenResponse.status,
        );
        return NextResponse.json(
          { error: "Failed to refresh Zoho access token." },
          { status: 400 },
        );
      }

      const newAccessToken =
        typeof tokenData.access_token === "string" && tokenData.access_token
          ? tokenData.access_token
          : null;
      const expiresIn = Number(tokenData.expires_in);

      console.log("[Zoho Mail Test] refresh access_token_received:", Boolean(newAccessToken));

      if (!newAccessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        return NextResponse.json(
          { error: "Zoho returned incomplete data during token refresh." },
          { status: 400 },
        );
      }

      accessToken = newAccessToken;
      const refreshTime = new Date();
      const newExpiresAt = new Date(refreshTime.getTime() + expiresIn * 1000);

      // Save refreshed token details back to zoho_connections
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
        console.error(
          "[Zoho Mail Test] Failed to update refreshed token in database:",
          updateError.message,
        );
        return NextResponse.json(
          { error: "Failed to persist refreshed access token." },
          { status: 500 },
        );
      }

      tokenRefreshed = true;
      console.log("[Zoho Mail Test] Token successfully refreshed and persisted.");
    } catch (error) {
      console.error(
        "[Zoho Mail Test] Error during token refresh request:",
        error instanceof Error ? error.message : "Unknown error",
      );
      return NextResponse.json(
        { error: "Failed to connect to Zoho for token refresh." },
        { status: 502 },
      );
    }
  }

  // Fetch one page of emails from Zoho Mail API
  const zohoAccountId = connection.zoho_account_id;
  try {
    // limit=10 retrieves the latest 10 messages
    const emailsUrl = `${mailBaseUrl}/accounts/${zohoAccountId}/messages/view?limit=10`;
    console.log(`[Zoho Mail Test] Fetching latest emails from: ${emailsUrl.replace(zohoAccountId, "ANONYMIZED_ID")}`);

    const emailResponse = await fetch(emailsUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    });

    const parsedPayload: unknown = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error(
        "[Zoho Mail Test] Zoho messages request failed status:",
        emailResponse.status,
        parsedPayload,
      );
      return NextResponse.json(
        { error: "Failed to retrieve emails from Zoho." },
        { status: 502 },
      );
    }

    if (typeof parsedPayload !== "object" || parsedPayload === null) {
      throw new Error("Zoho returned an invalid messages payload.");
    }

    const payload = parsedPayload as Record<string, unknown>;
    const messages = Array.isArray(payload.data) ? (payload.data as ZohoEmailItem[]) : [];

    // Map Zoho email items to safe response payload schema
    const safeEmails = messages.map((item) => {
      // Map receivedTime safely (could be millis timestamp or ISO string)
      let receivedAt = "unknown";
      if (item.receivedTime) {
        const parsedTime = Number(item.receivedTime);
        if (Number.isFinite(parsedTime)) {
          receivedAt = new Date(parsedTime).toISOString();
        } else {
          receivedAt = String(item.receivedTime);
        }
      }

      return {
        messageId: item.messageId || "unknown",
        folderId: item.folderId || "unknown",
        from: item.sender || item.fromAddress || "unknown",
        subject: item.subject || "(No Subject)",
        receivedAt,
        folder: item.folderName || "Inbox",
      };
    });

    return NextResponse.json(
      {
        message: "Zoho email page fetched successfully",
        count: safeEmails.length,
        tokenRefreshed,
        emails: safeEmails,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "[Zoho Mail Test] Error requesting Zoho messages:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      { error: "Failed to retrieve Zoho messages due to a server error." },
      { status: 502 },
    );
  }
}
