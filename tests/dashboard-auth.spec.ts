import { expect, test, type Page } from "@playwright/test";

type RouteRecord = {
  path: string;
  body: Record<string, unknown> | null;
};

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function installAuthMocks(
  page: Page,
  responses: {
    requestOtp?: unknown;
    verifyOtp?: unknown;
    completeTotpSetup?: unknown;
    verifyTotp?: unknown;
  },
  records: RouteRecord[],
) {
  await page.route("**/api/dashboard/auth/request-otp", async (route) => {
    records.push({ path: "request-otp", body: route.request().postDataJSON() as Record<string, unknown> });
    await route.fulfill(jsonResponse(responses.requestOtp ?? { ok: true, nextStep: "email_otp", challengeId: "otp-1" }));
  });

  await page.route("**/api/dashboard/auth/verify-otp", async (route) => {
    records.push({ path: "verify-otp", body: route.request().postDataJSON() as Record<string, unknown> });
    await route.fulfill(
      jsonResponse(
        responses.verifyOtp ?? {
          ok: true,
          stage: "totp_setup_required",
          challenge: "challenge-1",
          totpSecret: "SECRET-123",
          provisioningUri: "otpauth://totp/ApplyWizz:user@applywizz.ai?secret=SECRET-123",
        },
      ),
    );
  });

  await page.route("**/api/dashboard/auth/complete-totp-setup", async (route) => {
    records.push({ path: "complete-totp-setup", body: route.request().postDataJSON() as Record<string, unknown> });
    const response = responses.completeTotpSetup ?? { ok: true };
    await route.fulfill(jsonResponse(response, response && typeof response === "object" && "ok" in response && (response as { ok: boolean }).ok === false ? 400 : 200));
  });

  await page.route("**/api/dashboard/auth/verify-totp", async (route) => {
    records.push({ path: "verify-totp", body: route.request().postDataJSON() as Record<string, unknown> });
    const response = responses.verifyTotp ?? { ok: true };
    await route.fulfill(jsonResponse(response, response && typeof response === "object" && "ok" in response && (response as { ok: boolean }).ok === false ? 400 : 200));
  });
}

test.describe("Dashboard auth frontend", () => {
  test("requires a dashboard session for /dashboard", async ({ page }) => {
    await page.goto("/dashboard");

    // requireDashboardSession() fails closed to "/?expired=1", not the old
    // dedicated /dashboard/login screen.
    await expect(page).toHaveURL(/\/\?expired=1$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("does not let a fake dashboard session cookie bypass application auth", async ({ page }) => {
    await page.context().addCookies([
      {
        name: "dashboard_session",
        value: "fake-session-token",
        url: "http://localhost:3000",
      },
    ]);

    await page.goto("/overview");

    await expect(page).toHaveURL(/\/\?expired=1$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("redirects /dashboard/login to the login screen at / when no session cookie exists", async ({ page }) => {
    // /dashboard/login is now a thin redirect stub to "/" — it does not carry
    // the "?expired=1" flag, since that only happens on a session-guard
    // failure (requireDashboardSession()), not on this unconditional redirect.
    await page.goto("/dashboard/login");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "email");
  });

  test("renders the login screen when a fake dashboard session cookie is present", async ({ page }) => {
    await page.context().addCookies([
      {
        name: "dashboard_session",
        value: "existing-session",
        url: "http://localhost:3000",
      },
    ]);

    // "/" is the canonical login URL; it validates the cookie itself and only
    // falls through to the login screen when the session does not resolve.
    await page.goto("/");

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "email");
  });

  test("completes the first-time setup flow", async ({ page }) => {
    const records: RouteRecord[] = [];
    const consoleMessages: string[] = [];
    page.on("console", (message) => {
      consoleMessages.push(message.text());
    });
    await installAuthMocks(page, {}, records);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    await page.goto("/");
    await page.getByTestId("dashboard-auth-email").fill("  staff@applywizz.ai  ");
    await page.getByRole("button", { name: "Send OTP" }).click();

    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "otp");
    await page.getByTestId("dashboard-auth-otp").fill("123456");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "setup");
    await expect(page.getByRole("heading", { name: "Scan with your authenticator app" })).toBeVisible();
    // QR is shown; the raw provisioning URI is never exposed, and the secret is
    // hidden until the operator explicitly reveals it.
    await expect(page.getByTestId("dashboard-auth-qr").locator("svg")).toBeVisible();
    await expect(page.getByTestId("dashboard-auth-provisioning-uri")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-auth-totp-secret")).toHaveCount(0);

    await page.getByTestId("dashboard-auth-show-setup-key").click();
    await expect(page.getByTestId("dashboard-auth-totp-secret")).toContainText("SECRET-123");
    await page.getByTestId("dashboard-auth-copy-key").click();
    await expect(page.getByRole("status")).toContainText("copied");

    await page.getByTestId("dashboard-auth-setup-code").fill("654321");
    await page.getByRole("button", { name: "Complete setup" }).click();

    await page.waitForURL("**/overview");
    await expect(page).toHaveURL(/\/overview$/);

    expect(records).toEqual([
      { path: "request-otp", body: { email: "staff@applywizz.ai" } },
      { path: "verify-otp", body: { otpId: "otp-1", rawOtp: "123456" } },
      { path: "complete-totp-setup", body: { challenge: "challenge-1", code: "654321" } },
    ]);

    const persistence = await page.evaluate(async () => {
      const indexedDbNames =
        typeof indexedDB.databases === "function"
          ? (await indexedDB.databases()).map((db) => db.name ?? "")
          : [];

      const dump = (store: Storage) =>
        Object.keys(store)
          .map((key) => `${key}=${store.getItem(key) ?? ""}`)
          .join("\n");

      return {
        localKeys: Object.keys(localStorage),
        sessionKeys: Object.keys(sessionStorage),
        documentCookie: document.cookie,
        indexedDbNames,
        storageDump: `${dump(localStorage)}\n${dump(sessionStorage)}`,
      };
    });

    expect(persistence.localKeys).not.toContain("dashboard_session");
    expect(persistence.sessionKeys).not.toContain("dashboard_session");
    expect(persistence.documentCookie).not.toContain("dashboard_session");
    expect(persistence.indexedDbNames).not.toContain("dashboard_session");
    // The setup key and provisioning URI must never be persisted to the browser.
    expect(persistence.storageDump).not.toContain("SECRET-123");
    expect(persistence.storageDump).not.toContain("otpauth://");
    expect(consoleMessages.some((message) => /staff@applywizz\.ai|123456|654321|SECRET-123|otpauth:\/\/|challenge-1|session-token/i.test(message))).toBe(false);
  });

  test("clears revealed setup state after Start over", async ({ page }) => {
    await installAuthMocks(page, {}, []);

    await page.goto("/");
    await page.getByTestId("dashboard-auth-email").fill("staff@applywizz.ai");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.getByTestId("dashboard-auth-otp").fill("123456");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "setup");
    await page.getByTestId("dashboard-auth-show-setup-key").click();
    await expect(page.getByTestId("dashboard-auth-totp-secret")).toBeVisible();

    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "email");
    await expect(page.getByTestId("dashboard-auth-totp-secret")).toHaveCount(0);

    // Re-entering setup starts collapsed again — the reveal did not persist.
    await page.getByTestId("dashboard-auth-email").fill("staff@applywizz.ai");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.getByTestId("dashboard-auth-otp").fill("123456");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "setup");
    await expect(page.getByTestId("dashboard-auth-totp-secret")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-auth-show-setup-key")).toBeVisible();
  });

  test("returning user: authenticator code without email OTP, no QR setup, then logout", async ({ page }) => {
    const records: RouteRecord[] = [];
    await installAuthMocks(
      page,
      { requestOtp: { ok: true, nextStep: "totp", challenge: "challenge-login" } },
      records,
    );
    let logoutCalled = false;
    await page.route("**/api/dashboard/auth/logout", async (route) => {
      logoutCalled = true;
      await route.fulfill(jsonResponse({ ok: true }));
    });

    await page.goto("/");
    await page.getByTestId("dashboard-auth-email").fill("staff@applywizz.ai");
    await page.getByRole("button", { name: "Send OTP" }).click();

    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "login");
    await expect(page.getByRole("heading", { name: "Enter your authenticator code" })).toBeVisible();
    await expect(page.getByTestId("dashboard-auth-login-code")).toBeVisible();
    await expect(page.getByTestId("dashboard-auth-qr")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-auth-show-setup-key")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Scan with your authenticator app" })).toHaveCount(0);

    await page.getByTestId("dashboard-auth-login-code").fill("654321");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/overview");
    await expect(page).toHaveURL(/\/overview$/);

    const logoutOk = await page.evaluate(async () => (await fetch("/api/dashboard/auth/logout", { method: "POST" })).ok);
    expect(logoutOk).toBe(true);
    expect(logoutCalled).toBe(true);

    expect(records.map((record) => record.path)).toEqual(["request-otp", "verify-totp"]);
  });

  test("completes the returning-user login flow", async ({ page }) => {
    const records: RouteRecord[] = [];
    await installAuthMocks(
      page,
      {
        verifyOtp: {
          ok: true,
          stage: "totp_required",
          challenge: "challenge-2",
        },
        requestOtp: { ok: true, nextStep: "totp", challenge: "challenge-2" },
      },
      records,
    );

    await page.goto("/");
    await page.getByTestId("dashboard-auth-email").fill("staff@applywizz.ai");
    await page.getByRole("button", { name: "Send OTP" }).click();

    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "login");
    await expect(page.getByRole("heading", { name: "Enter your authenticator code" })).toBeVisible();

    await page.getByTestId("dashboard-auth-login-code").fill("654321");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("**/overview");
    await expect(page).toHaveURL(/\/overview$/);

    expect(records).toEqual([
      { path: "request-otp", body: { email: "staff@applywizz.ai" } },
      { path: "verify-totp", body: { challenge: "challenge-2", code: "654321" } },
    ]);
  });

  test("shows a generic error when OTP request fails", async ({ page }) => {
    const records: RouteRecord[] = [];
    await installAuthMocks(page, { requestOtp: { ok: false } }, records);

    await page.goto("/");
    await page.getByTestId("dashboard-auth-email").fill("staff@applywizz.ai");
    await page.getByRole("button", { name: "Send OTP" }).click();

    await expect(page.getByTestId("dashboard-auth-error")).toContainText("Sign-in failed. Try again.");
    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "email");
    expect(records).toEqual([{ path: "request-otp", body: { email: "staff@applywizz.ai" } }]);
  });

  test("shows a generic error when OTP verification fails", async ({ page }) => {
    const records: RouteRecord[] = [];
    await installAuthMocks(page, { verifyOtp: { ok: false } }, records);

    await page.goto("/");
    await page.getByTestId("dashboard-auth-email").fill("staff@applywizz.ai");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.getByTestId("dashboard-auth-otp").fill("123456");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByTestId("dashboard-auth-error")).toContainText("Sign-in failed. Try again.");
    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "otp");
  });

  test("shows a generic error when completing TOTP setup fails", async ({ page }) => {
    const records: RouteRecord[] = [];
    await installAuthMocks(page, { completeTotpSetup: { ok: false } }, records);

    await page.goto("/");
    await page.getByTestId("dashboard-auth-email").fill("staff@applywizz.ai");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.getByTestId("dashboard-auth-otp").fill("123456");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByTestId("dashboard-auth-setup-code").fill("654321");
    await page.getByRole("button", { name: "Complete setup" }).click();

    await expect(page.getByTestId("dashboard-auth-error")).toContainText("Sign-in failed. Try again.");
    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "setup");
  });

  test("shows a generic error when verifying TOTP fails", async ({ page }) => {
    const records: RouteRecord[] = [];
    await installAuthMocks(
      page,
      {
        requestOtp: { ok: true, nextStep: "totp", challenge: "challenge-2" },
        verifyOtp: {
          ok: true,
          stage: "totp_required",
          challenge: "challenge-2",
        },
        verifyTotp: { ok: false },
      },
      records,
    );

    await page.goto("/");
    await page.getByTestId("dashboard-auth-email").fill("staff@applywizz.ai");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.getByTestId("dashboard-auth-login-code").fill("654321");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByTestId("dashboard-auth-error")).toContainText("Sign-in failed. Try again.");
    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "login");
  });

  test("prevents duplicate OTP submissions", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/api/dashboard/auth/request-otp", async (route) => {
      requestCount += 1;
      await page.waitForTimeout(250);
      await route.fulfill(jsonResponse({ ok: true, otpId: "otp-1" }));
    });
    await page.route("**/api/dashboard/auth/verify-otp", async (route) => {
      await route.fulfill(
        jsonResponse({
          ok: true,
          stage: "totp_required",
          challenge: "challenge-2",
        }),
      );
    });
    await page.route("**/api/dashboard/auth/verify-totp", async (route) => {
      await route.fulfill(jsonResponse({ ok: true }));
    });

    await page.goto("/");
    await page.getByTestId("dashboard-auth-email").fill("staff@applywizz.ai");
    await page.getByRole("button", { name: "Send OTP" }).dblclick();

    await page.waitForTimeout(400);
    expect(requestCount).toBe(1);
  });

  test("restart clears sensitive state and errors", async ({ page }) => {
    await installAuthMocks(page, {}, []);

    await page.goto("/");
    await page.getByTestId("dashboard-auth-email").fill("staff@applywizz.ai");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.getByTestId("dashboard-auth-otp").fill("123456");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "setup");
    await page.getByRole("button", { name: "Start over" }).click();

    await expect(page.getByTestId("dashboard-auth-shell")).toHaveAttribute("data-step", "email");
    await expect(page.getByTestId("dashboard-auth-email")).toHaveValue("");
    await expect(page.getByTestId("dashboard-auth-error")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-auth-provisioning-uri")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-auth-totp-secret")).toHaveCount(0);
  });

  test("does not persist sensitive values in browser storage", async ({ page }) => {
    const records: RouteRecord[] = [];
    await installAuthMocks(page, {}, records);

    await page.goto("/");
    await page.getByTestId("dashboard-auth-email").fill("staff@applywizz.ai");
    await page.getByRole("button", { name: "Send OTP" }).click();
    await page.getByTestId("dashboard-auth-otp").fill("123456");
    await page.getByRole("button", { name: "Continue" }).click();

    const storage = await page.evaluate(async () => {
      const indexedDbNames =
        typeof indexedDB.databases === "function"
          ? (await indexedDB.databases()).map((db) => db.name ?? "")
          : [];

      return {
        localKeys: Object.keys(localStorage),
        sessionKeys: Object.keys(sessionStorage),
        documentCookie: document.cookie,
        indexedDbNames,
      };
    });

    expect(storage.localKeys).not.toContain("dashboard_session");
    expect(storage.sessionKeys).not.toContain("dashboard_session");
    expect(storage.documentCookie).not.toContain("dashboard_session");
    expect(storage.indexedDbNames).not.toContain("dashboard_session");
  });
});
