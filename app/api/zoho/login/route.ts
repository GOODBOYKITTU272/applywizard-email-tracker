import { type NextRequest, NextResponse } from "next/server";

import { getDashboardSessionByToken } from "@/lib/dashboardAuth/sessionStore";
import { isAdminCeo } from "@/lib/dashboardAuth/roles";
import { DASHBOARD_SESSION_COOKIE_NAME } from "@/lib/dashboardAuth/sessionCookie";
import { createZohoOAuthState } from "@/lib/zoho/oauthState";

/**
 * GET /api/zoho/login
 * GET /api/zoho/login?mailbox=tracker@applywizard.ai
 * GET /api/zoho/login?mailbox=tracker@applywizard.ai&recovery=true
 *
 * Redirects the browser to Zoho's OAuth authorization page.
 * Optional `mailbox` parameter names the exact @applywizard.ai address to connect.
 * When provided, the callback will reject any Zoho account that does not match.
 *
 * Recovery mode (`recovery=true`) additionally sends `prompt=consent`, which is
 * required for Zoho to reissue a refresh_token on a repeat authorization — by
 * default Zoho omits refresh_token once a client has already been granted
 * access (access_type=offline only guarantees one on the first grant).
 * Recovery requires an authenticated admin_ceo dashboard session and an
 * explicit mailbox — it targets one specific, already-known connection, never
 * a generic/first-account flow.
 *
 * State cookie stores an HMAC-signed, expiring token (see lib/zoho/oauthState)
 * encoding { csrf, mailbox, recovery, iat, exp } — httpOnly cookie flags alone
 * don't prove the app produced these values, so the callback verifies the
 * signature before trusting any of them. Only the opaque `csrf` UUID is sent
 * to Zoho as the `state` parameter — recovery is never trusted from the raw
 * redirect querystring on the way back, only from this signed cookie.
 *
 * Required environment variables:
 *   ZOHO_CLIENT_ID
 *   ZOHO_REDIRECT_URI
 *   ZOHO_ACCOUNTS_BASE_URL
 *   ZOHO_OAUTH_STATE_SECRET
 */

const MAILBOX_RE = /^[\w.+\-']+@applywizard\.ai$/i;

export async function GET(request: NextRequest): Promise<NextResponse> {
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

  const requestUrl = new URL(request.url);
  const rawMailbox = requestUrl.searchParams.get("mailbox") ?? "";
  const mailbox = rawMailbox.toLowerCase().trim();
  const recovery = requestUrl.searchParams.get("recovery") === "true";

  if (mailbox && !MAILBOX_RE.test(mailbox)) {
    return NextResponse.json(
      { error: "Invalid mailbox parameter. Must be a valid @applywizard.ai address." },
      { status: 400 },
    );
  }

  if (recovery) {
    // Recovery must target one specific, already-known connection — never a
    // generic/first-account flow.
    if (!mailbox) {
      return NextResponse.json(
        { error: "Recovery mode requires a mailbox parameter." },
        { status: 400 },
      );
    }

    const rawSessionToken = request.cookies.get(DASHBOARD_SESSION_COOKIE_NAME)?.value;
    if (!rawSessionToken) {
      return NextResponse.json(
        { error: "Recovery mode requires an authenticated admin session." },
        { status: 401 },
      );
    }

    const sessionResult = await getDashboardSessionByToken(rawSessionToken);
    if (!sessionResult.ok) {
      return NextResponse.json(
        { error: "Recovery mode requires an authenticated admin session." },
        { status: 401 },
      );
    }

    if (!isAdminCeo(sessionResult.session.user.role)) {
      return NextResponse.json(
        { error: "Recovery mode requires the admin_ceo role." },
        { status: 403 },
      );
    }
  }

  // csrf is the opaque value sent to Zoho as `state`.
  // mailbox/recovery are kept server-side in the signed cookie only — never sent to Zoho.
  const csrf = crypto.randomUUID();

  let signedState: string;
  try {
    signedState = createZohoOAuthState({ csrf, mailbox, recovery });
  } catch (error) {
    console.error(
      "[Zoho OAuth] Failed to sign OAuth state:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return NextResponse.json(
      { error: "Zoho OAuth is not configured on the server." },
      { status: 500 },
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "ZohoMail.messages.READ,ZohoMail.accounts.READ",
    access_type: "offline",
    state: csrf,
  });

  if (recovery) {
    params.set("prompt", "consent");
  }

  const authUrl = `${accountsBaseUrl}/oauth/v2/auth?${params.toString()}`;
  const response = NextResponse.redirect(authUrl);

  response.cookies.set("zoho_oauth_state", signedState, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/zoho/callback",
    maxAge: 600,
  });

  return response;
}
