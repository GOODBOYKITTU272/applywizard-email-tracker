import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { middleware } from "../../middleware";

const previousSecret = process.env.DASHBOARD_SECRET;

function request(pathname: string, authorization?: string) {
  return new NextRequest(`https://email-apply-wizz.test${pathname}`, {
    headers: authorization ? { authorization } : undefined,
  });
}

function basicAuth(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

afterEach(() => {
  if (previousSecret === undefined) delete process.env.DASHBOARD_SECRET;
  else process.env.DASHBOARD_SECRET = previousSecret;
});

describe("middleware Basic Auth", () => {
  it("challenges protected COO routes without credentials", () => {
    process.env.DASHBOARD_SECRET = "test-dashboard-secret";

    for (const pathname of ["/dashboard", "/overview", "/clients", "/clients/example", "/operations", "/review-queue", "/live-monitor", "/live-monitor/email-arrival"]) {
      const response = middleware(request(pathname));
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe('Basic realm="ApplyWizard Dashboard"');
    }
  });

  it("allows protected COO routes with valid credentials", () => {
    process.env.DASHBOARD_SECRET = "test-dashboard-secret";

    const response = middleware(request("/clients/example", basicAuth("admin", "test-dashboard-secret")));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows protected live monitor routes with valid credentials", () => {
    process.env.DASHBOARD_SECRET = "test-dashboard-secret";

    const response = middleware(request("/live-monitor/email-arrival", basicAuth("admin", "test-dashboard-secret")));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("leaves non-COO routes unaffected", () => {
    process.env.DASHBOARD_SECRET = "test-dashboard-secret";

    const response = middleware(request("/api/zoho/workflow/cron"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("WWW-Authenticate")).toBe(false);
  });
});
