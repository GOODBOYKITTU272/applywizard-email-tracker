import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface ZohoDetailsData {
  messageId: string;
  sender: string;
  fromAddress?: string;
  subject: string;
  receivedTime: string | number;
  toAddress?: string;
  ccAddress?: string;
  hasAttachment?: string | number;
  size?: string | number;
  folderId?: string;
}

interface ZohoContentData {
  messageId: string;
  content: string;
}

interface ZohoAPIResponse<T> {
  status: {
    code: number;
    description: string;
  };
  data?: T;
}

function extractEmails(str?: string): string[] {
  if (!str || str === "Not Provided" || str === "None") return [];
  // Decode HTML entities like &lt; and &gt;
  const decoded = str.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const matches = decoded.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
  return matches ? Array.from(new Set(matches.map(e => e.toLowerCase().trim()))) : [];
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");

  if (!messageId) {
    return NextResponse.json({ error: "Missing messageId in URL path." }, { status: 400 });
  }

  if (!folderId) {
    return NextResponse.json(
      { error: "Missing required folderId query parameter." },
      { status: 400 },
    );
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const accountsBaseUrl = process.env.ZOHO_ACCOUNTS_BASE_URL;
  const mailBaseUrl = process.env.ZOHO_MAIL_BASE_URL;

  if (!clientId || !clientSecret || !accountsBaseUrl || !mailBaseUrl) {
    console.error("[Zoho Mail Detail] Missing required Zoho API configuration env vars.");
    return NextResponse.json(
      { error: "Zoho API configuration is incomplete on the server." },
      { status: 500 },
    );
  }

  const supabase = createSupabaseServerClient();

  // Find the latest active Zoho connection
  const { data: connection, error: connError } = await supabase
    .from("zoho_connections")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (connError) {
    console.error("[Zoho Mail Detail] Failed to query zoho_connections:", connError.message);
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

  let accessToken = connection.access_token;
  const expiresAt = new Date(connection.access_token_expires_at).getTime();
  const now = Date.now();
  const bufferTime = 5 * 60 * 1000; // 5 minute buffer

  if (expiresAt < now + bufferTime) {
    console.log(`[Zoho Mail Detail] Access token expired or near expiry. Refreshing...`);

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
          "[Zoho Mail Detail] Token refresh failed:",
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

      console.log("[Zoho Mail Detail] refresh access_token_received:", Boolean(newAccessToken));

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
          "[Zoho Mail Detail] Failed to update refreshed token in database:",
          updateError.message,
        );
        return NextResponse.json(
          { error: "Failed to persist refreshed access token." },
          { status: 500 },
        );
      }

      console.log("[Zoho Mail Detail] Token successfully refreshed and persisted.");
    } catch (error) {
      console.error(
        "[Zoho Mail Detail] Error during token refresh request:",
        error instanceof Error ? error.message : "Unknown error",
      );
      return NextResponse.json(
        { error: "Failed to connect to Zoho for token refresh." },
        { status: 502 },
      );
    }
  }

  const zohoAccountId = connection.zoho_account_id;

  try {
    const detailsUrl = `${mailBaseUrl}/accounts/${zohoAccountId}/folders/${folderId}/messages/${messageId}/details`;
    const contentUrl = `${mailBaseUrl}/accounts/${zohoAccountId}/folders/${folderId}/messages/${messageId}/content`;

    console.log(`[Zoho Mail Detail] Fetching email details from: ${detailsUrl.replace(zohoAccountId, "ANONYMIZED_ID")}`);
    console.log(`[Zoho Mail Detail] Fetching email content from: ${contentUrl.replace(zohoAccountId, "ANONYMIZED_ID")}`);

    const [detailsRes, contentRes] = await Promise.all([
      fetch(detailsUrl, {
        headers: {
          Accept: "application/json",
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
      }),
      fetch(contentUrl, {
        headers: {
          Accept: "application/json",
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
      }),
    ]);

    if (!detailsRes.ok || !contentRes.ok) {
      console.error(
        `[Zoho Mail Detail] Failed to fetch email. Details Status: ${detailsRes.status}, Content Status: ${contentRes.status}`,
      );
      return NextResponse.json(
        { error: "Failed to retrieve email content from Zoho." },
        { status: 502 },
      );
    }

    const [detailsPayload, contentPayload] = await Promise.all([
      detailsRes.json() as Promise<ZohoAPIResponse<ZohoDetailsData>>,
      contentRes.json() as Promise<ZohoAPIResponse<ZohoContentData>>,
    ]);

    if (detailsPayload.status?.code !== 200 || contentPayload.status?.code !== 200) {
      console.error(
        "[Zoho Mail Detail] Zoho API returned non-success code:",
        detailsPayload.status,
        contentPayload.status,
      );
      return NextResponse.json(
        { error: "Zoho API returned an error retrieving the message." },
        { status: 502 },
      );
    }

    const details = detailsPayload.data as ZohoDetailsData;
    const contentData = contentPayload.data as ZohoContentData;

    if (!details || !contentData) {
      throw new Error("Zoho API response missing expected data fields.");
    }

    const toList = extractEmails(details.toAddress);
    const ccList = extractEmails(details.ccAddress);

    let receivedAt = "unknown";
    if (details.receivedTime) {
      const parsedTime = Number(details.receivedTime);
      if (Number.isFinite(parsedTime)) {
        receivedAt = new Date(parsedTime).toISOString();
      } else {
        receivedAt = String(details.receivedTime);
      }
    }

    const hasAttachments =
      details.hasAttachment === "1" ||
      details.hasAttachment === 1 ||
      Boolean(Number(details.hasAttachment));

    const bodyHtml = contentData.content || "";
    const bodyText = stripHtml(bodyHtml);

    return NextResponse.json({
      message: "Zoho email fetched successfully",
      email: {
        messageId: details.messageId || messageId,
        from: details.sender || details.fromAddress || "unknown",
        to: toList,
        cc: ccList,
        subject: details.subject || "(No Subject)",
        receivedAt,
        folder: folderId, // For verification route, folderId is returned as the folder identifier
        bodyText,
        bodyHtml,
        hasAttachments,
        attachmentCount: hasAttachments ? 1 : 0, // Fallback to 1 if hasAttachments is true
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(
      "[Zoho Mail Detail] Error fetching email details/content:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      { error: "Failed to retrieve Zoho email content due to a server error." },
      { status: 502 },
    );
  }
}
