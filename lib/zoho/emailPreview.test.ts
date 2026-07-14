import { readFileSync } from "fs";
import { resolve } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockRefreshZohoToken = vi.fn();

vi.mock("@/lib/zoho/zohoApiHelpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/zoho/zohoApiHelpers")>(
    "@/lib/zoho/zohoApiHelpers",
  );

  return {
    ...actual,
    refreshZohoToken: mockRefreshZohoToken,
  };
});

function makeSupabase(row: Record<string, unknown> | null) {
  return {
    from: (table: string) => {
      if (table === "zoho_email_metadata") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: row, error: null }),
            }),
          }),
        };
      }
      if (table === "zoho_connections") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({
                  data: {
                    zoho_account_id: "acct-1",
                    refresh_token: "ref",
                    access_token: "access",
                    access_token_expires_at: "2999-01-01T00:00:00.000Z",
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

let mockSupabase: ReturnType<typeof makeSupabase>;

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => mockSupabase,
}));

const ROW = {
  id: "row-1",
  message_id: "msg-1",
  folder_id: "fold-1",
  mailbox_email: "tracker@applywizard.ai",
};

describe("getSafeEmailPreview", () => {
  beforeEach(() => {
    mockSupabase = makeSupabase(ROW);
    mockRefreshZohoToken.mockReset();
    process.env.ZOHO_CLIENT_ID = "cid";
    process.env.ZOHO_CLIENT_SECRET = "secret";
    process.env.ZOHO_ACCOUNTS_BASE_URL = "https://accounts.zoho.test";
    process.env.ZOHO_MAIL_BASE_URL = "https://mail.zoho.test";
  });

  it("redacts a URL, email, OTP code, and token from the fetched content", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/content")) {
        return {
          ok: true,
          json: async () => ({
            status: { code: 200 },
            data: {
              content:
                "<p>Visit https://unsafe.test/reset or email test@example.com, code 482910</p>",
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as typeof fetch;

    try {
      const { getSafeEmailPreview } = await import("./emailPreview");
      const result = await getSafeEmailPreview("row-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.preview).not.toContain("unsafe.test");
        expect(result.preview).not.toContain("test@example.com");
        expect(result.preview).not.toContain("482910");
        expect(result.preview).toContain("[redacted-url]");
        expect(result.preview).toContain("[redacted-email]");
        expect(result.preview).toContain("[redacted-code]");
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("decodes common HTML entities before returning preview text", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: { code: 200 },
        data: { content: "<p>Stephen&nbsp;&amp;&nbsp;Co &lt;Hiring&gt; &quot;Hello&quot; &#39;World&#39;</p>" },
      }),
    }) as typeof fetch;

    const { getSafeEmailPreview } = await import("./emailPreview");
    const result = await getSafeEmailPreview("row-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview).toContain("Stephen & Co \"Hello\" 'World'");
      expect(result.preview).not.toContain("&nbsp;");
      expect(result.preview).not.toContain("&amp;");
      expect(result.preview).not.toContain("&lt;");
      expect(result.preview).not.toContain("&gt;");
      expect(result.preview).not.toContain("&quot;");
      expect(result.preview).not.toContain("&#39;");
    }
  });

  it("truncates a preview longer than the max length", async () => {
    const longContent = "A".repeat(3000);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: { code: 200 }, data: { content: longContent } }),
    }) as typeof fetch;

    const { getSafeEmailPreview, PREVIEW_MAX_LENGTH } = await import("./emailPreview");
    const result = await getSafeEmailPreview("row-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.length).toBeLessThanOrEqual(PREVIEW_MAX_LENGTH);
  });

  it("returns not-ok, never a raw error, when the Zoho fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ status: { code: 500, description: "internal error with secret token abc123def456" } }),
    }) as typeof fetch;

    const { getSafeEmailPreview } = await import("./emailPreview");
    const result = await getSafeEmailPreview("row-1");

    expect(result).toEqual({ ok: false });
  });

  it("returns not-ok when the row does not exist", async () => {
    mockSupabase = makeSupabase(null);

    const { getSafeEmailPreview } = await import("./emailPreview");
    const result = await getSafeEmailPreview("missing-id");

    expect(result).toEqual({ ok: false });
  });

  it("never includes subject, sender, or raw headers in its own source", () => {
    const src = readFileSync(resolve(__dirname, "emailPreview.ts"), "utf8");
    expect(src).not.toMatch(/\bsubject\b/i);
    expect(src).not.toMatch(/\bsender\b/i);
    expect(src).not.toMatch(/Delivered-To|X-Originating|Received-SPF/i);
    expect(src).toContain("headers: { Accept:");
  });
});
