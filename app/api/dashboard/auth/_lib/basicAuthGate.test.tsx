import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function makeRequest(authorization?: string): NextRequest {
  return new NextRequest("https://email-apply-wizz.test/api/dashboard/auth/request-otp", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

const previousSecret = process.env.DASHBOARD_SECRET;

beforeEach(() => {
  process.env.DASHBOARD_SECRET = "test-dashboard-secret";
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.DASHBOARD_SECRET;
  else process.env.DASHBOARD_SECRET = previousSecret;
  vi.restoreAllMocks();
});

describe("requireDashboardBasicAuth", () => {
  it("rejects missing authorization header", async () => {
    const { requireDashboardBasicAuth } = await import("./basicAuthGate");
    const res = requireDashboardBasicAuth(makeRequest());
    expect(res?.status).toBe(401);
    expect(res?.headers.get("WWW-Authenticate")).toBe('Basic realm="ApplyWizard Dashboard"');
  });

  it("rejects malformed authorization header", async () => {
    const { requireDashboardBasicAuth } = await import("./basicAuthGate");
    const res = requireDashboardBasicAuth(makeRequest("Basic not-base64!!"));
    expect(res?.status).toBe(401);
  });

  it("rejects wrong username", async () => {
    const { requireDashboardBasicAuth } = await import("./basicAuthGate");
    const res = requireDashboardBasicAuth(makeRequest(basicAuth("not-admin", "test-dashboard-secret")));
    expect(res?.status).toBe(401);
  });

  it("rejects wrong password", async () => {
    const { requireDashboardBasicAuth } = await import("./basicAuthGate");
    const res = requireDashboardBasicAuth(makeRequest(basicAuth("admin", "wrong-password")));
    expect(res?.status).toBe(401);
  });

  it("rejects when DASHBOARD_SECRET is missing", async () => {
    delete process.env.DASHBOARD_SECRET;
    const { requireDashboardBasicAuth } = await import("./basicAuthGate");
    const res = requireDashboardBasicAuth(makeRequest(basicAuth("admin", "test-dashboard-secret")));
    expect(res?.status).toBe(401);
  });

  it("accepts valid credentials", async () => {
    const { requireDashboardBasicAuth } = await import("./basicAuthGate");
    expect(requireDashboardBasicAuth(makeRequest(basicAuth("admin", "test-dashboard-secret")))).toBeNull();
  });

  it("accepts passwords containing colons", async () => {
    process.env.DASHBOARD_SECRET = "part1:part2:part3";
    const { requireDashboardBasicAuth } = await import("./basicAuthGate");
    expect(requireDashboardBasicAuth(makeRequest(basicAuth("admin", "part1:part2:part3")))).toBeNull();
  });

  it("does not log credentials", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { requireDashboardBasicAuth } = await import("./basicAuthGate");
    requireDashboardBasicAuth(makeRequest(basicAuth("admin", "wrong-password")));

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
