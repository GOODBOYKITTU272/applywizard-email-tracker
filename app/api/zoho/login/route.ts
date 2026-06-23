import { type NextRequest, NextResponse } from "next/server";

/**
 * GET /api/zoho/login
 * GET /api/zoho/login?mailbox=tracker@applywizard.ai
 *
 * Redirects the browser to Zoho's OAuth authorization page.
 * Optional `mailbox` parameter names the exact @applywizard.ai address to connect.
 * When provided, the callback will reject any Zoho account that does not match.
 *
 * State cookie stores { csrf, mailbox } as JSON (httpOnly).
 * Only the opaque `csrf` UUID is sent to Zoho as the `state` parameter.
 *
 * Required environment variables:
 *   ZOHO_CLIENT_ID
 *   ZOHO_REDIRECT_URI
 *   ZOHO_ACCOUNTS_BASE_URL
 */

const MAILBOX_RE = /^[\w.+\-']+@applywizard\.ai$/i;

export function GET(request: NextRequest): NextResponse {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;
  const accountsBaseUrl = process.env.ZOHO_ACCOUNTS_BASE_URL;

  if (!clientId || !redirectUri || !accountsBaseUrl) {
    console.error(
      "[Zoho OAuth] Missing environment variables: " +
        "ZOHO_CLIENT_ID, ZOHO_REDIRECT_URI, or ZOHO_ACCOUNTS_BASE_URL.",
    );
    return NextResponse.json(
      {
        error:
          "Zoho OAuth is not configured. " +
          "Check that ZOHO_CLIENT_ID, ZOHO_REDIRECT_URI, and " +
          "ZOHO_ACCOUNTS_BASE_URL are set in your environment.",
      },
      { status: 500 },
    );
  }

  const rawMailbox = new URL(request.url).searchParams.get("mailbox") ?? "";
  const mailbox = rawMailbox.toLowerCase().trim();

  if (mailbox && !MAILBOX_RE.test(mailbox)) {
    return NextResponse.json(
      { error: "Invalid mailbox parameter. Must be a valid @applywizard.ai address." },
      { status: 400 },
    );
  }

  // csrf is the opaque value sent to Zoho as `state`.
  // mailbox is kept server-side in the httpOnly cookie only — never sent to Zoho.
  const csrf = crypto.randomUUID();
  const cookiePayload = JSON.stringify({ csrf, mailbox });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "ZohoMail.messages.READ,ZohoMail.accounts.READ",
    access_type: "offline",
    state: csrf,
  });

  const authUrl = `${accountsBaseUrl}/oauth/v2/auth?${params.toString()}`;
  const response = NextResponse.redirect(authUrl);

  response.cookies.set("zoho_oauth_state", cookiePayload, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/zoho/callback",
    maxAge: 600,
  });

  return response;
}
