import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { verifyZohoOAuthState } from "@/lib/zoho/oauthState";

const STATE_COOKIE = "zoho_oauth_state";

function clearOAuthState(response: NextResponse): NextResponse {
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/zoho/callback",
    maxAge: 0,
  });
  return response;
}

function invalidStateResponse(): NextResponse {
  // Deliberately generic — never leaks which specific check (signature,
  // expiry, version, malformed encoding) failed.
  return clearOAuthState(
    NextResponse.json(
      { error: "Invalid OAuth state. Please start the login flow again." },
      { status: 400 },
    ),
  );
}

/**
 * GET /api/zoho/callback
 *
 * Validates OAuth state, exchanges the one-time code, reads Zoho account
 * metadata, and stores the connection in Supabase. It never reads emails.
 *
 * When the login flow included ?mailbox=..., this callback requires an exact
 * match in the returned Zoho accounts. It never falls back to the admin mailbox.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const receivedState = searchParams.get("state");
  const rawCookie = request.cookies.get(STATE_COOKIE)?.value;

  if (!receivedState || !rawCookie) {
    return invalidStateResponse();
  }

  // Rejects missing/malformed/tampered/expired/wrong-version state before any
  // token exchange, Supabase lookup, or Supabase write — mailbox and recovery
  // are only trusted after this passes. No unsigned/legacy state is accepted.
  const verified = verifyZohoOAuthState(rawCookie);
  if (!verified.ok) {
    return invalidStateResponse();
  }

  const { csrf: expectedCsrf, mailbox: requestedMailbox, recovery } = verified.state;

  if (receivedState !== expectedCsrf) {
    return invalidStateResponse();
  }

  const zohoError = searchParams.get("error");
  if (zohoError) {
    console.error("[Zoho OAuth] Zoho returned an error:", zohoError);
    return clearOAuthState(
      NextResponse.json(
        { error: `Zoho returned an error: ${zohoError}` },
        { status: 400 },
      ),
    );
  }

  const code = searchParams.get("code");
  if (!code) {
    return clearOAuthState(
      NextResponse.json(
        { error: "Missing authorization code. Please try the login flow again." },
        { status: 400 },
      ),
    );
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;
  const accountsBaseUrl = process.env.ZOHO_ACCOUNTS_BASE_URL;
  const mailBaseUrl = process.env.ZOHO_MAIL_BASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !clientId ||
    !clientSecret ||
    !redirectUri ||
    !accountsBaseUrl ||
    !mailBaseUrl ||
    !supabaseUrl ||
    !supabaseServiceRoleKey
  ) {
    console.error("[Zoho OAuth] Missing server environment variables.");
    return clearOAuthState(
      NextResponse.json(
        { error: "Zoho OAuth or Supabase is not configured on the server." },
        { status: 500 },
      ),
    );
  }

  let tokenData: Record<string, unknown>;

  try {
    const tokenResponse = await fetch(`${accountsBaseUrl}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }).toString(),
    });
    const parsed: unknown = await tokenResponse.json();

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Zoho returned an invalid token response.");
    }
    if (!tokenResponse.ok) {
      console.error("[Zoho OAuth] Token exchange failed:", tokenResponse.status);
      return clearOAuthState(
        NextResponse.json({ error: "Zoho token exchange failed." }, { status: 400 }),
      );
    }

    tokenData = parsed as Record<string, unknown>;
  } catch (error) {
    console.error(
      "[Zoho OAuth] Token exchange request failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return clearOAuthState(
      NextResponse.json(
        { error: "Failed to reach Zoho for token exchange. Try again later." },
        { status: 502 },
      ),
    );
  }

  const accessToken =
    typeof tokenData.access_token === "string" && tokenData.access_token
      ? tokenData.access_token
      : null;
  const newRefreshToken =
    typeof tokenData.refresh_token === "string" && tokenData.refresh_token
      ? tokenData.refresh_token
      : null;
  const expiresIn = Number(tokenData.expires_in);

  console.log("[Zoho OAuth] access_token_received:", Boolean(accessToken));
  console.log("[Zoho OAuth] refresh_token_received:", Boolean(newRefreshToken));
  console.log("[Zoho OAuth] recovery_mode:", recovery);

  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return clearOAuthState(
      NextResponse.json(
        { error: "Zoho returned incomplete token data." },
        { status: 400 },
      ),
    );
  }

  let accountPayload: unknown;

  try {
    const accountResponse = await fetch(`${mailBaseUrl}/accounts`, {
      headers: {
        Accept: "application/json",
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    });
    accountPayload = await accountResponse.json();

    if (!accountResponse.ok) {
      console.error(
        "[Zoho OAuth] Account metadata request failed:",
        accountResponse.status,
      );
      return clearOAuthState(
        NextResponse.json(
          { error: "Failed to retrieve Zoho account metadata." },
          { status: 502 },
        ),
      );
    }
  } catch (error) {
    console.error(
      "[Zoho OAuth] Account metadata request failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return clearOAuthState(
      NextResponse.json(
        { error: "Failed to retrieve Zoho account metadata." },
        { status: 502 },
      ),
    );
  }

  const accounts =
    typeof accountPayload === "object" && accountPayload !== null
      ? (accountPayload as Record<string, unknown>).data
      : null;

  if (!Array.isArray(accounts)) {
    return clearOAuthState(
      NextResponse.json(
        { error: "Zoho did not return a usable mail account." },
        { status: 502 },
      ),
    );
  }

  // Predicate: a well-formed, enabled Zoho mail account entry.
  const isValidAccount = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).type === "ZOHO_ACCOUNT" &&
    (value as Record<string, unknown>).enabled !== false &&
    typeof (value as Record<string, unknown>).accountId === "string" &&
    ((value as Record<string, unknown>).accountId as string).trim().length > 0 &&
    typeof (value as Record<string, unknown>).primaryEmailAddress === "string" &&
    ((value as Record<string, unknown>).primaryEmailAddress as string).trim().length > 0;

  let account: Record<string, unknown> | null = null;

  if (requestedMailbox) {
    // Targeted flow: require exact match to the requested mailbox.
    // Never fall back to any other account.
    const match = accounts.find(
      (a) =>
        isValidAccount(a) &&
        (a.primaryEmailAddress as string).toLowerCase().trim() === requestedMailbox,
    );
    if (!match) {
      console.error("[Zoho OAuth] Requested mailbox not found in returned accounts.");
      return clearOAuthState(
        NextResponse.json(
          {
            error:
              "Requested mailbox was not returned by Zoho. " +
              "Verify it is a separate Zoho Mail account and retry.",
          },
          { status: 400 },
        ),
      );
    }
    account = match as Record<string, unknown>;
  } else {
    // Generic flow: first valid account (original behavior).
    account = (accounts.find(isValidAccount) ?? null) as Record<string, unknown> | null;
  }

  if (!account) {
    return clearOAuthState(
      NextResponse.json(
        { error: "Zoho did not return a usable mail account." },
        { status: 502 },
      ),
    );
  }

  const zohoAccountId = account.accountId as string;
  const emailAddress = (account.primaryEmailAddress as string).trim().toLowerCase();

  const supabase = createSupabaseServerClient();
  const { data: existing, error: readError } = await supabase
    .from("zoho_connections")
    .select("refresh_token")
    .eq("email_address", emailAddress)
    .maybeSingle();

  if (readError) {
    console.error("[Zoho OAuth] Connection lookup failed:", readError.message);
    return clearOAuthState(
      NextResponse.json(
        { error: "Failed to store the Zoho connection." },
        { status: 500 },
      ),
    );
  }

  const existingRefreshToken =
    typeof existing?.refresh_token === "string" ? existing.refresh_token : null;

  // Recovery mode exists specifically to replace a broken refresh_token — it
  // must never fall back to the old one, or a failed recovery would silently
  // look like a success while leaving the same broken connection in place.
  if (recovery) {
    if (!newRefreshToken) {
      return clearOAuthState(
        NextResponse.json(
          {
            error:
              "Zoho did not issue a new refresh token. Recovery was not completed.",
          },
          { status: 400 },
        ),
      );
    }
  } else if (!newRefreshToken && !existingRefreshToken) {
    return clearOAuthState(
      NextResponse.json(
        {
          error:
            "Zoho did not return a refresh token. Revoke access and reconnect.",
        },
        { status: 400 },
      ),
    );
  }

  const refreshToken = recovery ? newRefreshToken! : (newRefreshToken || existingRefreshToken)!;

  const now = new Date();
  const { error: writeError } = await supabase.from("zoho_connections").upsert(
    {
      zoho_account_id: zohoAccountId,
      email_address: emailAddress,
      status: "active",
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_expires_at: new Date(
        now.getTime() + expiresIn * 1000,
      ).toISOString(),
      updated_at: now.toISOString(),
    },
    { onConflict: "email_address" },
  );

  if (writeError) {
    console.error("[Zoho OAuth] Connection write failed:", writeError.message);
    return clearOAuthState(
      NextResponse.json(
        { error: "Failed to store the Zoho connection." },
        { status: 500 },
      ),
    );
  }

  if (recovery) {
    return clearOAuthState(
      NextResponse.json(
        {
          message: "Zoho OAuth recovery completed.",
          new_refresh_token_received: true,
          connection_updated: true,
        },
        { headers: { "Cache-Control": "no-store" } },
      ),
    );
  }

  return clearOAuthState(
    NextResponse.json(
      {
        message: "Zoho OAuth complete. Connection stored safely.",
        new_refresh_token_received: Boolean(newRefreshToken),
        existing_refresh_token_preserved: !newRefreshToken && Boolean(existingRefreshToken),
      },
      { headers: { "Cache-Control": "no-store" } },
    ),
  );
}
