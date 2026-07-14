import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const FAKE_TOKEN_ENV = {
  MICROSOFT_TENANT_ID: "fake-tenant-id",
  MICROSOFT_CLIENT_ID: "fake-client-id",
  MICROSOFT_CLIENT_SECRET: "fake-client-secret",
};
const FAKE_FROM_EMAIL = "dashboard-otp@example.test";
const FAKE_ACCESS_TOKEN = "fake-access-token-abc";

function stubAllEnv() {
  vi.stubEnv("MICROSOFT_TENANT_ID", FAKE_TOKEN_ENV.MICROSOFT_TENANT_ID);
  vi.stubEnv("MICROSOFT_CLIENT_ID", FAKE_TOKEN_ENV.MICROSOFT_CLIENT_ID);
  vi.stubEnv("MICROSOFT_CLIENT_SECRET", FAKE_TOKEN_ENV.MICROSOFT_CLIENT_SECRET);
  vi.stubEnv("MICROSOFT_OTP_FROM_EMAIL", FAKE_FROM_EMAIL);
}

function tokenResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getMicrosoftGraphAccessToken", () => {
  it("returns ok:false when required env vars are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { getMicrosoftGraphAccessToken } = await import("./microsoftGraphOtp");

    await expect(getMicrosoftGraphAccessToken()).resolves.toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests a token using the tenant/client/client-secret envs via client_credentials grant", async () => {
    stubAllEnv();
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse({ access_token: FAKE_ACCESS_TOKEN }));
    vi.stubGlobal("fetch", fetchMock);

    const { getMicrosoftGraphAccessToken } = await import("./microsoftGraphOtp");

    await expect(getMicrosoftGraphAccessToken()).resolves.toEqual({ ok: true, accessToken: FAKE_ACCESS_TOKEN });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://login.microsoftonline.com/${FAKE_TOKEN_ENV.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`);
    expect(init.method).toBe("POST");

    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe(FAKE_TOKEN_ENV.MICROSOFT_CLIENT_ID);
    expect(body.get("client_secret")).toBe(FAKE_TOKEN_ENV.MICROSOFT_CLIENT_SECRET);
    expect(body.get("scope")).toBe("https://graph.microsoft.com/.default");
  });

  it("returns ok:false when the token response is not ok", async () => {
    stubAllEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tokenResponse({ error: "invalid_client" }, 401)));

    const { getMicrosoftGraphAccessToken } = await import("./microsoftGraphOtp");

    await expect(getMicrosoftGraphAccessToken()).resolves.toEqual({ ok: false });
  });

  it("returns ok:false when access_token is missing from an ok response", async () => {
    stubAllEnv();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(tokenResponse({ token_type: "Bearer" })));

    const { getMicrosoftGraphAccessToken } = await import("./microsoftGraphOtp");

    await expect(getMicrosoftGraphAccessToken()).resolves.toEqual({ ok: false });
  });

  it("returns ok:false when the request throws", async () => {
    stubAllEnv();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failed")));

    const { getMicrosoftGraphAccessToken } = await import("./microsoftGraphOtp");

    await expect(getMicrosoftGraphAccessToken()).resolves.toEqual({ ok: false });
  });
});

describe("sendDashboardOtpEmail", () => {
  it("returns ok:false when MICROSOFT_OTP_FROM_EMAIL is missing", async () => {
    vi.stubEnv("MICROSOFT_TENANT_ID", FAKE_TOKEN_ENV.MICROSOFT_TENANT_ID);
    vi.stubEnv("MICROSOFT_CLIENT_ID", FAKE_TOKEN_ENV.MICROSOFT_CLIENT_ID);
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", FAKE_TOKEN_ENV.MICROSOFT_CLIENT_SECRET);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { sendDashboardOtpEmail } = await import("./microsoftGraphOtp");

    await expect(sendDashboardOtpEmail({ to: "staff@applywizz.ai", otp: "123456" })).resolves.toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns ok:false when the token request fails, without calling sendMail", async () => {
    stubAllEnv();
    const fetchMock = vi.fn().mockResolvedValue(tokenResponse({ error: "invalid_client" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    const { sendDashboardOtpEmail } = await import("./microsoftGraphOtp");

    await expect(sendDashboardOtpEmail({ to: "staff@applywizz.ai", otp: "123456" })).resolves.toEqual({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends only to the approved recipient using the configured sender, with a bearer token", async () => {
    stubAllEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse({ access_token: FAKE_ACCESS_TOKEN }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendDashboardOtpEmail } = await import("./microsoftGraphOtp");

    await expect(sendDashboardOtpEmail({ to: "staff@applywizz.ai", otp: "123456" })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(FAKE_FROM_EMAIL)}/sendMail`);

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`);

    const body = JSON.parse(init.body as string);
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "staff@applywizz.ai" } }]);
    expect(body.message.toRecipients).toHaveLength(1);
    expect(body.message.body.content).toContain("123456");
  });

  it("returns ok:false when the Graph sendMail request is not ok", async () => {
    stubAllEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse({ access_token: FAKE_ACCESS_TOKEN }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendDashboardOtpEmail } = await import("./microsoftGraphOtp");

    await expect(sendDashboardOtpEmail({ to: "staff@applywizz.ai", otp: "123456" })).resolves.toEqual({ ok: false });
  });

  it("returns ok:false when the send request throws", async () => {
    stubAllEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse({ access_token: FAKE_ACCESS_TOKEN }))
      .mockRejectedValueOnce(new Error("network failed"));
    vi.stubGlobal("fetch", fetchMock);

    const { sendDashboardOtpEmail } = await import("./microsoftGraphOtp");

    await expect(sendDashboardOtpEmail({ to: "staff@applywizz.ai", otp: "123456" })).resolves.toEqual({ ok: false });
  });

  it("never logs the access token, client secret, auth header, Graph error, or OTP", async () => {
    stubAllEnv();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse({ access_token: FAKE_ACCESS_TOKEN }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Forbidden secret leak test" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { sendDashboardOtpEmail } = await import("./microsoftGraphOtp");
    await sendDashboardOtpEmail({ to: "staff@applywizz.ai", otp: "654321" });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
