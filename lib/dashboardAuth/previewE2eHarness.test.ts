import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  PREVIEW_E2E_ACTION_TIMEOUT_MS,
  PREVIEW_E2E_LOGIN_CONTROL_TEST_ID,
  PREVIEW_E2E_NAVIGATION_TIMEOUT_MS,
  PREVIEW_E2E_SETUP_CONTROL_TEST_ID,
  PREVIEW_E2E_SOFT_NAV_LINK,
  detectPostOtpBranch,
  promptForOtpWithTimeout,
  runPreviewDashboardAuthE2EWithDeps,
  validatePreviewE2eEnvironment,
} from "../../scripts/dashboard-auth/previewE2eHarness";

type BranchPage = Parameters<typeof detectPostOtpBranch>[0];

function branchLocator(behavior: "resolve" | "reject" | "never" | number, visible: boolean) {
  return {
    waitFor: () => {
      if (behavior === "resolve") return Promise.resolve();
      if (behavior === "reject") return Promise.reject(new Error("Timeout 30000ms exceeded"));
      if (behavior === "never") return new Promise<void>(() => {});
      return new Promise<void>((resolve) => setTimeout(resolve, behavior));
    },
    isVisible: async () => visible,
    fill: async () => {},
    click: async () => {},
    textContent: async () => null,
  };
}

function branchPage(opts: {
  setup?: "resolve" | "reject" | "never" | number;
  login?: "resolve" | "reject" | "never" | number;
  setupVisible?: boolean;
  loginVisible?: boolean;
}): BranchPage {
  const setupLoc = branchLocator(opts.setup ?? "resolve", opts.setupVisible ?? false);
  const loginLoc = branchLocator(opts.login ?? "reject", opts.loginVisible ?? false);
  const fallback = branchLocator("resolve", false);
  return {
    getByTestId: (id: string) =>
      id === PREVIEW_E2E_SETUP_CONTROL_TEST_ID ? setupLoc : id === PREVIEW_E2E_LOGIN_CONTROL_TEST_ID ? loginLoc : fallback,
    getByRole: () => fallback,
    getByText: () => ({ first: () => fallback }),
    goto: async () => undefined,
    waitForURL: async () => {},
    evaluate: async () => true,
  } as unknown as BranchPage;
}

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DASHBOARD_AUTH_E2E_TARGET: "preview",
    DASHBOARD_AUTH_SEED_TARGET: "preview",
    DASHBOARD_PREVIEW_URL: "https://applywizard-email-tracker-git-worker-preflight-preview.vercel.app",
    DASHBOARD_TEST_ADMIN_EMAIL: "dashboard-auth-test@applywizz.ai",
    DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF: "zyxwvutsrqponmlkjihg",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    ...overrides,
  };
}

function makeHarnessDeps(
  options: {
    linkThrows?: boolean;
    cleanupOk?: boolean;
    revokeOk?: boolean;
    revealVisible?: boolean;
    secretWaitThrows?: boolean;
    launchThrows?: boolean;
    newContextThrows?: boolean;
    newPageThrows?: boolean;
    setTimeoutThrows?: boolean;
    contextCloseThrows?: boolean;
    branchNeither?: boolean;
    branchLoginNever?: boolean;
  } = {},
) {
  const events: string[] = [];
  const locator = (name: string) => ({
    fill: vi.fn(async () => events.push(`fill:${name}`)),
    click: vi.fn(async () => {
      events.push(`click:${name}`);
      if (options.linkThrows && name === PREVIEW_E2E_SOFT_NAV_LINK) throw new Error("navigation failed");
    }),
    isVisible: vi.fn(async () => {
      if (options.revealVisible && name === "Can't scan? Show setup key") return true;
      return false;
    }),
    textContent: vi.fn(async () => "JBSWY3DPEHPK3PXP"),
    waitFor: vi.fn(async () => {
      if (options.secretWaitThrows && name === "dashboard-auth-totp-secret") {
        throw new Error("Timeout 30000ms exceeded waiting for locator");
      }
      if (options.branchNeither && (name === PREVIEW_E2E_SETUP_CONTROL_TEST_ID || name === PREVIEW_E2E_LOGIN_CONTROL_TEST_ID)) {
        throw new Error("Timeout 30000ms exceeded waiting for locator");
      }
      if (options.branchLoginNever && name === PREVIEW_E2E_LOGIN_CONTROL_TEST_ID) {
        return new Promise<void>(() => {});
      }
      events.push(`wait:${name}`);
    }),
  });
  const page = {
    goto: vi.fn(async (url: string) => events.push(`goto:${new URL(url).pathname}`)),
    getByTestId: vi.fn((testId: string) => locator(testId)),
    getByRole: vi.fn((_role: string, opts: { name: string }) => locator(opts.name)),
    getByText: vi.fn((text: string) => ({ first: () => locator(text) })),
    waitForURL: vi.fn(async (url: string) => events.push(`waitForURL:${new URL(url).pathname}`)),
    evaluate: vi.fn(async () => {
      events.push("logout");
      return true;
    }),
  };
  const context = {
    newPage: vi.fn(async () => {
      if (options.newPageThrows) throw new Error("newPage failed");
      return page;
    }),
    close: vi.fn(async () => {
      events.push("context-close");
      if (options.contextCloseThrows) throw new Error("context close failed");
    }),
    setDefaultTimeout: vi.fn(() => {
      if (options.setTimeoutThrows) throw new Error("setDefaultTimeout failed");
    }),
    setDefaultNavigationTimeout: vi.fn(),
  };
  const browser = {
    newContext: vi.fn(async () => {
      if (options.newContextThrows) throw new Error("newContext failed");
      return context;
    }),
    close: vi.fn(async () => events.push("browser-close")),
  };
  const launchBrowser = vi.fn(async () => {
    if (options.launchThrows) throw new Error("launch failed");
    return browser;
  });
  const createSupabase = vi.fn(() => ({}) as never);
  const promptForOtp = vi.fn(async () => "123456");
  const revokeSessionsForEmail = vi.fn(async () => {
    events.push("revoke");
    return { ok: options.revokeOk ?? true };
  });
  const disableAdmin = vi.fn(async () => {
    events.push("cleanup");
    return { ok: options.cleanupOk ?? true };
  });

  return {
    browser,
    context,
    createSupabase,
    disableAdmin,
    events,
    launchBrowser,
    page,
    promptForOtp,
    revokeSessionsForEmail,
  };
}

function harnessDepsFor(deps: ReturnType<typeof makeHarnessDeps>) {
  return {
    createSupabase: deps.createSupabase,
    disableAdmin: deps.disableAdmin,
    launchBrowser: deps.launchBrowser,
    promptForOtp: deps.promptForOtp,
    revokeSessionsForEmail: deps.revokeSessionsForEmail,
  };
}

describe("preview E2E harness guards", () => {
  it("refuses production URL", () => {
    expect(
      validatePreviewE2eEnvironment(
        env({
          DASHBOARD_PREVIEW_URL: "https://email-apply-wizz.vercel.app",
        }),
      ),
    ).toEqual({ ok: false, code: "PRODUCTION_URL" });
  });

  it("refuses missing Preview URL", () => {
    expect(validatePreviewE2eEnvironment(env({ DASHBOARD_PREVIEW_URL: "" }))).toEqual({
      ok: false,
      code: "MISSING_PREVIEW_URL",
    });
  });

  it("refuses mismatched Supabase project", () => {
    expect(
      validatePreviewE2eEnvironment(
        env({
          NEXT_PUBLIC_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
        }),
      ),
    ).toEqual({ ok: false, code: "PROJECT_REF_MISMATCH" });
  });

  it("requires the cleanup seed target flag", () => {
    expect(validatePreviewE2eEnvironment(env({ DASHBOARD_AUTH_SEED_TARGET: "" }))).toEqual({
      ok: false,
      code: "INVALID_SEED_TARGET",
    });
  });

  it("requires a production project reference", () => {
    expect(validatePreviewE2eEnvironment(env({ DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF: "" }))).toEqual({
      ok: false,
      code: "MISSING_PRODUCTION_PROJECT_REF",
    });
  });

  it("rejects equal Preview and production project refs", () => {
    expect(
      validatePreviewE2eEnvironment(
        env({
          DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
        }),
      ),
    ).toEqual({ ok: false, code: "PRODUCTION_PROJECT_REF" });
  });

  it("refuses malformed Supabase URL", () => {
    expect(validatePreviewE2eEnvironment(env({ NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }))).toEqual({
      ok: false,
      code: "MALFORMED_SUPABASE_URL",
    });
  });

  it("refuses missing Preview project reference", () => {
    expect(validatePreviewE2eEnvironment(env({ DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF: "" }))).toEqual({
      ok: false,
      code: "MISSING_PROJECT_REF",
    });
  });

  it("refuses deceptive production-like hostnames", () => {
    expect(
      validatePreviewE2eEnvironment(
        env({
          DASHBOARD_PREVIEW_URL: "https://email-apply-wizz.vercel.app.evil.example",
        }),
      ),
    ).toEqual({ ok: false, code: "PRODUCTION_URL" });
  });

  it("requires the Preview target flag", () => {
    expect(validatePreviewE2eEnvironment(env({ DASHBOARD_AUTH_E2E_TARGET: "production" }))).toEqual({
      ok: false,
      code: "INVALID_TARGET",
    });
  });

  it("does not run without required safety configuration", () => {
    expect(validatePreviewE2eEnvironment(env({ DASHBOARD_TEST_ADMIN_EMAIL: "" }))).toEqual({
      ok: false,
      code: "MISSING_EMAIL",
    });
    expect(validatePreviewE2eEnvironment(env({ SUPABASE_SERVICE_ROLE_KEY: "" }))).toEqual({
      ok: false,
      code: "MISSING_SERVICE_ROLE_KEY",
    });
  });

  it("accepts an explicitly configured Preview target", () => {
    expect(validatePreviewE2eEnvironment(env())).toEqual({
      ok: true,
      config: {
        previewUrl: "https://applywizard-email-tracker-git-worker-preflight-preview.vercel.app",
        normalizedEmail: "dashboard-auth-test@applywizz.ai",
        projectRef: "abcdefghijklmnopqrst",
        productionProjectRef: "zyxwvutsrqponmlkjihg",
      },
    });
  });

  it("does not launch a browser when validation fails", async () => {
    const launchBrowser = vi.fn();

    await expect(
      runPreviewDashboardAuthE2EWithDeps(env({ DASHBOARD_AUTH_E2E_TARGET: "" }), { launchBrowser }),
    ).resolves.toEqual({ ok: false, code: "INVALID_TARGET" });
    expect(launchBrowser).not.toHaveBeenCalled();
  });

});

describe("preview E2E harness flow", () => {
  it("uses an existing navigation link after revoking sessions", async () => {
    const deps = makeHarnessDeps();

    await expect(
      runPreviewDashboardAuthE2EWithDeps(env(), {
        createSupabase: deps.createSupabase,
        disableAdmin: deps.disableAdmin,
        launchBrowser: deps.launchBrowser,
        promptForOtp: deps.promptForOtp,
        revokeSessionsForEmail: deps.revokeSessionsForEmail,
      }),
    ).resolves.toEqual({ ok: true });

    const revokeIndex = deps.events.indexOf("revoke");
    const clickIndex = deps.events.indexOf(`click:${PREVIEW_E2E_SOFT_NAV_LINK}`);
    expect(PREVIEW_E2E_SOFT_NAV_LINK).toBe("Clients");
    expect(revokeIndex).toBeGreaterThan(-1);
    expect(clickIndex).toBeGreaterThan(revokeIndex);
  });

  it("runs cleanup after a soft-navigation assertion failure", async () => {
    const deps = makeHarnessDeps({ linkThrows: true });

    await expect(
      runPreviewDashboardAuthE2EWithDeps(env(), {
        createSupabase: deps.createSupabase,
        disableAdmin: deps.disableAdmin,
        launchBrowser: deps.launchBrowser,
        promptForOtp: deps.promptForOtp,
        revokeSessionsForEmail: deps.revokeSessionsForEmail,
      }),
    ).rejects.toThrow("navigation failed");
    expect(deps.disableAdmin).toHaveBeenCalled();
  });

  it("fails the run when mandatory cleanup fails", async () => {
    const deps = makeHarnessDeps({ cleanupOk: false });

    await expect(
      runPreviewDashboardAuthE2EWithDeps(env(), {
        createSupabase: deps.createSupabase,
        disableAdmin: deps.disableAdmin,
        launchBrowser: deps.launchBrowser,
        promptForOtp: deps.promptForOtp,
        revokeSessionsForEmail: deps.revokeSessionsForEmail,
      }),
    ).resolves.toEqual({ ok: false, code: "CLEANUP_FAILED" });
  });

  it("configures bounded action and navigation timeouts", async () => {
    const deps = makeHarnessDeps();

    await expect(runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps))).resolves.toEqual({ ok: true });

    expect(deps.context.setDefaultTimeout).toHaveBeenCalledWith(PREVIEW_E2E_ACTION_TIMEOUT_MS);
    expect(deps.context.setDefaultNavigationTimeout).toHaveBeenCalledWith(PREVIEW_E2E_NAVIGATION_TIMEOUT_MS);
    expect(PREVIEW_E2E_ACTION_TIMEOUT_MS).toBe(30_000);
  });

  it("fails and cleans up when the setup key never renders after reveal", async () => {
    const deps = makeHarnessDeps({ secretWaitThrows: true });

    await expect(runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps))).rejects.toThrow(/Timeout/);
    expect(deps.disableAdmin).toHaveBeenCalled();
  });

  it("times out with a deterministic failure and cleans up when the operator never enters an OTP", async () => {
    const deps = makeHarnessDeps();
    const neverResolves = vi.fn(() => new Promise<string>(() => {}));

    await expect(
      runPreviewDashboardAuthE2EWithDeps(env(), {
        ...harnessDepsFor(deps),
        promptForOtp: neverResolves,
        otpInputTimeoutMs: 20,
      }),
    ).rejects.toThrow("OTP_INPUT_TIMEOUT");
    expect(deps.disableAdmin).toHaveBeenCalled();
  });

  it("does not import the reviewed server-only session store", () => {
    const source = readFileSync("scripts/dashboard-auth/previewE2eHarness.ts", "utf8");

    expect(source).not.toContain("sessionStore");
    expect(source).not.toContain("getDashboardSessionByToken");
  });
});

describe("preview E2E harness browser lifecycle cleanup", () => {
  it("invokes admin cleanup when browser launch fails, leaving no resource open", async () => {
    const deps = makeHarnessDeps({ launchThrows: true });

    await expect(runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps))).rejects.toThrow("launch failed");
    expect(deps.disableAdmin).toHaveBeenCalled();
    expect(deps.context.close).not.toHaveBeenCalled();
    expect(deps.browser.close).not.toHaveBeenCalled();
  });

  it("closes the browser and invokes admin cleanup when context creation fails", async () => {
    const deps = makeHarnessDeps({ newContextThrows: true });

    await expect(runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps))).rejects.toThrow("newContext failed");
    expect(deps.browser.close).toHaveBeenCalledTimes(1);
    expect(deps.disableAdmin).toHaveBeenCalled();
    expect(deps.context.close).not.toHaveBeenCalled();
  });

  it("closes context and browser and invokes admin cleanup when page creation fails", async () => {
    const deps = makeHarnessDeps({ newPageThrows: true });

    await expect(runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps))).rejects.toThrow("newPage failed");
    expect(deps.context.close).toHaveBeenCalledTimes(1);
    expect(deps.browser.close).toHaveBeenCalledTimes(1);
    expect(deps.disableAdmin).toHaveBeenCalled();
  });

  it("reaches full cleanup when timeout configuration fails", async () => {
    const deps = makeHarnessDeps({ setTimeoutThrows: true });

    await expect(runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps))).rejects.toThrow("setDefaultTimeout failed");
    expect(deps.context.close).toHaveBeenCalledTimes(1);
    expect(deps.browser.close).toHaveBeenCalledTimes(1);
    expect(deps.disableAdmin).toHaveBeenCalled();
  });

  it("still closes the browser and cleans up when context close itself fails", async () => {
    const deps = makeHarnessDeps({ newPageThrows: true, contextCloseThrows: true });

    await expect(runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps))).rejects.toThrow("newPage failed");
    expect(deps.context.close).toHaveBeenCalledTimes(1);
    expect(deps.browser.close).toHaveBeenCalledTimes(1);
    expect(deps.disableAdmin).toHaveBeenCalled();
  });

  it("cleans up in a fixed order: admin, then context, then browser", async () => {
    const deps = makeHarnessDeps({ newPageThrows: true });

    await expect(runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps))).rejects.toThrow("newPage failed");
    const cleanupIndex = deps.events.indexOf("cleanup");
    const contextIndex = deps.events.indexOf("context-close");
    const browserIndex = deps.events.indexOf("browser-close");
    expect(cleanupIndex).toBeGreaterThanOrEqual(0);
    expect(contextIndex).toBeGreaterThan(cleanupIndex);
    expect(browserIndex).toBeGreaterThan(contextIndex);
  });

  it("closes each browser resource exactly once on a successful run", async () => {
    const deps = makeHarnessDeps();

    await expect(runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps))).resolves.toEqual({ ok: true });
    expect(deps.context.close).toHaveBeenCalledTimes(1);
    expect(deps.browser.close).toHaveBeenCalledTimes(1);
  });
});

describe("preview E2E post-OTP branch detection", () => {
  it("detects a setup screen that renders after a delay", async () => {
    await expect(detectPostOtpBranch(branchPage({ setup: 15, login: "never" }))).resolves.toBe("setup");
  });

  it("detects a login screen that renders after a delay", async () => {
    await expect(detectPostOtpBranch(branchPage({ setup: "never", login: 15 }))).resolves.toBe("login");
  });

  it("fails deterministically, without secrets, when neither control appears", async () => {
    const page = branchPage({ setup: "reject", login: "reject" });
    await expect(detectPostOtpBranch(page)).rejects.toThrow("BRANCH_DETECTION_FAILED");
    // The failure carries no OTP, secret, or key material — only a stable code.
    await detectPostOtpBranch(page).catch((error: unknown) => {
      expect((error as Error).message).toBe("BRANCH_DETECTION_FAILED");
    });
  });

  it("fails deterministically when both controls appear at once", async () => {
    await expect(
      detectPostOtpBranch(branchPage({ setup: "resolve", login: "resolve", setupVisible: true, loginVisible: true })),
    ).rejects.toThrow("BRANCH_DETECTION_AMBIGUOUS");
  });
});

describe("preview E2E branch handling in the full run", () => {
  it("clicks the setup reveal control only after it has appeared", async () => {
    const deps = makeHarnessDeps({ branchLoginNever: true });

    await expect(runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps))).resolves.toEqual({ ok: true });
    const waitIndex = deps.events.indexOf(`wait:${PREVIEW_E2E_SETUP_CONTROL_TEST_ID}`);
    const clickIndex = deps.events.indexOf(`click:${PREVIEW_E2E_SETUP_CONTROL_TEST_ID}`);
    expect(waitIndex).toBeGreaterThanOrEqual(0);
    expect(clickIndex).toBeGreaterThan(waitIndex);
  });

  it("runs admin, context, and browser cleanup when branch detection fails", async () => {
    const deps = makeHarnessDeps({ branchNeither: true });

    await expect(runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps))).rejects.toThrow("BRANCH_DETECTION_FAILED");
    expect(deps.disableAdmin).toHaveBeenCalled();
    expect(deps.context.close).toHaveBeenCalledTimes(1);
    expect(deps.browser.close).toHaveBeenCalledTimes(1);
  });

  it("never logs the OTP or setup key during a run", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeHarnessDeps({ branchLoginNever: true });

    await runPreviewDashboardAuthE2EWithDeps(env(), harnessDepsFor(deps));

    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
    expect(logged).not.toContain("JBSWY3DPEHPK3PXP");
    expect(logged).not.toContain("123456");
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("default operator OTP prompt cancellation", () => {
  it("times out deterministically and releases the readline interface", async () => {
    const promptInput = new PassThrough();
    const promptOutput = new PassThrough();

    await expect(promptForOtpWithTimeout("Enter OTP: ", 20, { input: promptInput, output: promptOutput })).rejects.toThrow(
      "OTP_INPUT_TIMEOUT",
    );
    // readline removed its stdin listeners on close, so nothing keeps the CLI alive.
    expect(promptInput.listenerCount("data")).toBe(0);
    expect(promptInput.listenerCount("readable")).toBe(0);
    // Late input after timeout is ignored — no resolve, no throw.
    expect(() => promptInput.write("999999\n")).not.toThrow();
  });

  it("resolves with valid input before timeout and never echoes the OTP", async () => {
    const promptInput = new PassThrough();
    const promptOutput = new PassThrough();
    const written: string[] = [];
    promptOutput.on("data", (chunk) => written.push(String(chunk)));

    const pending = promptForOtpWithTimeout("Enter OTP: ", 10_000, { input: promptInput, output: promptOutput });
    promptInput.write("123456\n");

    await expect(pending).resolves.toBe("123456");
    expect(written.join("")).not.toContain("123456");
    // The interface is closed; further input has no effect and does not hang.
    expect(() => promptInput.write("000000\n")).not.toThrow();
  });
});
