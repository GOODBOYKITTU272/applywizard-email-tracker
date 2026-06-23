/**
 * Unit tests for GET /api/zoho/login route.
 * Tests the login route handler directly — no live OAuth, no Supabase.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

function setRequiredEnvVars() {
  process.env.ZOHO_CLIENT_ID = "test-client-id";
  process.env.ZOHO_REDIRECT_URI = "http://localhost:3000/api/zoho/callback";
  process.env.ZOHO_ACCOUNTS_BASE_URL = "https://accounts.zoho.test";
}

function clearEnvVars() {
  delete process.env.ZOHO_CLIENT_ID;
  delete process.env.ZOHO_REDIRECT_URI;
  delete process.env.ZOHO_ACCOUNTS_BASE_URL;
}

describe("GET /api/zoho/login", () => {
  beforeEach(setRequiredEnvVars);
  afterEach(clearEnvVars);

  it("redirects to Zoho with opaque UUID state — not JSON in the URL", async () => {
    const { GET } = await import("../../app/api/zoho/login/route");
    const req = makeRequest("http://localhost:3000/api/zoho/login");
    const res = GET(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("accounts.zoho.test");

    // state param must be a UUID — not a JSON string
    const stateParam = new URL(location).searchParams.get("state") ?? "";
    expect(stateParam).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(stateParam).not.toContain("{");
    expect(stateParam).not.toContain("mailbox");
  });

  it("stores requested mailbox in cookie — not in the Zoho redirect URL", async () => {
    const { GET } = await import("../../app/api/zoho/login/route");
    const req = makeRequest(
      "http://localhost:3000/api/zoho/login?mailbox=tracker@applywizard.ai",
    );
    const res = GET(req);

    expect(res.status).toBe(307);

    // Mailbox must NOT be in the Zoho redirect URL
    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("tracker");

    // Mailbox IS in the state cookie
    const cookieHeader = res.headers.get("set-cookie") ?? "";
    expect(cookieHeader).toContain("zoho_oauth_state");
    expect(cookieHeader).toContain("tracker%40applywizard.ai");
  });

  it("normalizes mailbox to lowercase", async () => {
    const { GET } = await import("../../app/api/zoho/login/route");
    const req = makeRequest(
      "http://localhost:3000/api/zoho/login?mailbox=TRACKER@APPLYWIZARD.AI",
    );
    const res = GET(req);

    expect(res.status).toBe(307);
    const cookieHeader = res.headers.get("set-cookie") ?? "";
    expect(cookieHeader).toContain("tracker%40applywizard.ai");
    expect(cookieHeader).not.toContain("TRACKER");
  });

  it("rejects invalid mailbox parameter — non-applywizard.ai domain", async () => {
    const { GET } = await import("../../app/api/zoho/login/route");
    const req = makeRequest(
      "http://localhost:3000/api/zoho/login?mailbox=hacker@gmail.com",
    );
    const res = GET(req);

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Invalid mailbox parameter");
  });

  it("rejects malformed mailbox parameter", async () => {
    const { GET } = await import("../../app/api/zoho/login/route");
    const req = makeRequest(
      "http://localhost:3000/api/zoho/login?mailbox=notanemail",
    );
    const res = GET(req);

    expect(res.status).toBe(400);
  });

  it("no mailbox parameter proceeds without restriction (backward compat)", async () => {
    const { GET } = await import("../../app/api/zoho/login/route");
    const req = makeRequest("http://localhost:3000/api/zoho/login");
    const res = GET(req);

    expect(res.status).toBe(307);
    // Cookie should still set, with empty mailbox
    const cookieHeader = res.headers.get("set-cookie") ?? "";
    expect(cookieHeader).toContain("zoho_oauth_state");
  });

  it("returns 500 when env vars are missing", async () => {
    clearEnvVars();
    const { GET } = await import("../../app/api/zoho/login/route");
    const req = makeRequest("http://localhost:3000/api/zoho/login");
    const res = GET(req);
    expect(res.status).toBe(500);
  });
});
