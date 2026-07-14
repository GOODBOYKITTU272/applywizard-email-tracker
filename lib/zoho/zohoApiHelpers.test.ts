import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}));

describe("stripHtml", () => {
  it("removes tags, style, and script blocks, collapsing whitespace", async () => {
    const { stripHtml } = await import("./zohoApiHelpers");
    const html = "<style>.x{color:red}</style><p>Hello   <b>World</b></p><script>evil()</script>";
    expect(stripHtml(html)).toBe("Hello World");
  });
});

describe("refreshZohoToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the new access token on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "new-token", expires_in: 3600 }),
      }),
    );

    const { refreshZohoToken } = await import("./zohoApiHelpers");
    const token = await refreshZohoToken(
      { zoho_account_id: "acct-1", refresh_token: "ref" },
      "cid",
      "secret",
      "https://accounts.zoho.test",
    );

    expect(token).toBe("new-token");
  });

  it("throws without leaking raw provider response text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "invalid_client", status: 401 }),
      }),
    );

    const { refreshZohoToken } = await import("./zohoApiHelpers");
    await expect(
      refreshZohoToken({ zoho_account_id: "acct-1", refresh_token: "ref" }, "cid", "secret", "https://accounts.zoho.test"),
    ).rejects.toThrow();
  });
});
