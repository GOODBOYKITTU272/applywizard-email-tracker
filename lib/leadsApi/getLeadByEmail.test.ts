import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fallback = {
  clientName: "Unmatched",
  assignedCaName: "Not mapped",
  assignedCaEmail: "-",
};

describe("getLeadByEmail", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv("LEADS_API_BASE_URL", "https://leads.example.test/leads");
    vi.stubEnv("LEADS_API_USERNAME", "user");
    vi.stubEnv("LEADS_API_PASSWORD", "password");
  });

  it("returns client and assigned CA details for an exact email match", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            name: "Client One",
            email: "client@example.test",
            assigned_associate: { name: "CA One", email: "ca@example.test" },
          },
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getLeadByEmail } = await import("./getLeadByEmail");

    await expect(getLeadByEmail("client@example.test")).resolves.toEqual({
      clientName: "Client One",
      assignedCaName: "CA One",
      assignedCaEmail: "ca@example.test",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("search=client%40example.test");
  });

  it("matches email case-insensitively", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                name: "Client Two",
                email: "CLIENT@example.test",
                assigned_associate: { name: "CA Two", email: "ca2@example.test" },
              },
            ],
          }),
        ),
      ),
    );

    const { getLeadByEmail } = await import("./getLeadByEmail");

    await expect(getLeadByEmail("client@example.test")).resolves.toEqual({
      clientName: "Client Two",
      assignedCaName: "CA Two",
      assignedCaEmail: "ca2@example.test",
    });
  });

  it("returns fallback when no exact match exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ name: "Other", email: "other@example.test", assigned_associate: {} }])),
      ),
    );

    const { getLeadByEmail } = await import("./getLeadByEmail");

    await expect(getLeadByEmail("client@example.test")).resolves.toEqual(fallback);
  });

  it("returns fallback on Leads API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failed")));

    const { getLeadByEmail } = await import("./getLeadByEmail");

    await expect(getLeadByEmail("client@example.test")).resolves.toEqual(fallback);
  });

  it("returns fallback on Leads API timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_: unknown, init?: RequestInit) => {
        init?.signal?.addEventListener("abort", () => {});
        return new Promise(() => {});
      }),
    );

    const { getLeadByEmail } = await import("./getLeadByEmail");
    const result = getLeadByEmail("client@example.test");

    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toEqual(fallback);
  });

  it("caches matched and unmatched lookups by lowercased email within the TTL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([])));
    vi.stubGlobal("fetch", fetchMock);

    const { getLeadByEmail } = await import("./getLeadByEmail");

    await expect(getLeadByEmail("CLIENT@example.test")).resolves.toEqual(fallback);
    await expect(getLeadByEmail("client@example.test")).resolves.toEqual(fallback);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches matched lookups by lowercased email within the TTL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            name: "Cached Client",
            email: "client@example.test",
            assigned_associate: { name: "Cached CA", email: "cached-ca@example.test" },
          },
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getLeadByEmail } = await import("./getLeadByEmail");

    await expect(getLeadByEmail("CLIENT@example.test")).resolves.toEqual({
      clientName: "Cached Client",
      assignedCaName: "Cached CA",
      assignedCaEmail: "cached-ca@example.test",
    });
    await expect(getLeadByEmail("client@example.test")).resolves.toEqual({
      clientName: "Cached Client",
      assignedCaName: "Cached CA",
      assignedCaEmail: "cached-ca@example.test",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
