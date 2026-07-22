import "server-only";

interface MicrosoftGraphTokenConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

function getMicrosoftGraphTokenConfig(): MicrosoftGraphTokenConfig | null {
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

function getMicrosoftGraphFromEmail(): string | null {
  return process.env.MICROSOFT_OTP_FROM_EMAIL || null;
}

export type MicrosoftGraphTokenResult = { ok: true; accessToken: string } | { ok: false };

export async function getMicrosoftGraphAccessToken(): Promise<MicrosoftGraphTokenResult> {
  const config = getMicrosoftGraphTokenConfig();
  if (!config) return { ok: false };

  try {
    const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }).toString(),
    });

    if (!response.ok) return { ok: false };

    const payload: unknown = await response.json();
    const accessToken =
      typeof payload === "object" && payload !== null && typeof (payload as Record<string, unknown>).access_token === "string"
        ? ((payload as Record<string, unknown>).access_token as string)
        : null;

    if (!accessToken) return { ok: false };

    return { ok: true, accessToken };
  } catch {
    return { ok: false };
  }
}

export type SendDashboardOtpEmailResult =
  | { ok: true }
  | { ok: false; reason: "explicit_failure" | "timeout_or_unknown" };

export async function sendDashboardOtpEmail(params: { to: string; otp: string }): Promise<SendDashboardOtpEmailResult> {
  const fromEmail = getMicrosoftGraphFromEmail();
  if (!fromEmail) return { ok: false, reason: "explicit_failure" };

  const tokenResult = await getMicrosoftGraphAccessToken();
  if (!tokenResult.ok) return { ok: false, reason: "explicit_failure" };

  try {
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromEmail)}/sendMail`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: "Your ApplyWizz dashboard verification code",
          body: {
            contentType: "Text",
            content: `Your dashboard verification code is ${params.otp}. This code expires shortly and should not be shared.`,
          },
          toRecipients: [{ emailAddress: { address: params.to } }],
        },
        saveToSentItems: false,
      }),
    });

    if (!response.ok) return { ok: false, reason: "explicit_failure" };

    return { ok: true };
  } catch {
    return { ok: false, reason: "timeout_or_unknown" };
  }
}
