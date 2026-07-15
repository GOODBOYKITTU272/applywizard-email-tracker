import { describe, expect, it, vi } from "vitest";

import { fetchAllLeads, LeadsFetchError } from "@/lib/leadsSync/fetchLeads";

const env = {
  LEADS_API_BASE_URL: "https://leads.example.test/api/v1/leads/",
  LEADS_API_USERNAME: "sync-user",
  LEADS_API_PASSWORD: "sync-password",
} as NodeJS.ProcessEnv;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function page(results: unknown[], count: number, next: unknown = null) {
  return { count, next, previous: null, results, total_count: count, status_counts: {} };
}

const noSleep = () => Promise.resolve();

async function expectFetchError(promise: Promise<unknown>, code: string): Promise<LeadsFetchError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LeadsFetchError);
    expect((error as LeadsFetchError).code).toBe(code);
    return error as LeadsFetchError;
  }
  throw new Error(`expected LeadsFetchError ${code}`);
}

describe("fetchAllLeads", () => {
  it("sends a runtime-generated Basic Authorization header with the filter params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(page([{ id: 1 }], 1)));

    await fetchAllLeads({ env, fetchImpl, sleep: noSleep });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("sync-user:sync-password").toString("base64")}`,
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("page_size")).toBe("all");
    expect(parsed.searchParams.get("status")).toBe("In Progress");
    expect(parsed.searchParams.get("services_opted")).toBe("applications");
    expect(parsed.searchParams.get("services_opted_logic")).toBe("and");
  });

  it("rejects missing credentials before any request", async () => {
    const fetchImpl = vi.fn();
    await expectFetchError(
      fetchAllLeads({ env: { ...env, LEADS_API_PASSWORD: " " }, fetchImpl }),
      "LEADS_AUTH_MISSING",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns typed leads from a single complete page", async () => {
    const leads = [{ id: 1, name: "A" }, { id: 2, name: "B" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(page(leads, 2)));

    const result = await fetchAllLeads({ env, fetchImpl, sleep: noSleep });

    expect(result.leads).toEqual(leads);
    expect(result.declaredCount).toBe(2);
    expect(result.httpStatus).toBe(200);
    expect(result.pages).toBe(1);
  });

  it("follows same-origin next links across pages", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(page([{ id: 1 }], 3, "https://leads.example.test/api/v1/leads/?page=2")),
      )
      .mockResolvedValueOnce(
        jsonResponse(page([{ id: 2 }, { id: 3 }], 3, null)),
      );

    const result = await fetchAllLeads({ env, fetchImpl, sleep: noSleep });

    expect(result.leads.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(result.pages).toBe(2);
  });

  it("fails on count mismatch without writing anything", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(page([{ id: 1 }], 5)));
    await expectFetchError(fetchAllLeads({ env, fetchImpl, sleep: noSleep }), "LEADS_COUNT_MISMATCH");
  });

  it("rejects unexpected pagination shapes and cross-origin next links", async () => {
    const badType = vi.fn().mockResolvedValue(jsonResponse(page([{ id: 1 }], 1, 42)));
    await expectFetchError(fetchAllLeads({ env, fetchImpl: badType, sleep: noSleep }), "LEADS_PAGINATION_UNEXPECTED");

    const crossOrigin = vi
      .fn()
      .mockResolvedValue(jsonResponse(page([{ id: 1 }], 1, "https://evil.example.test/leads?page=2")));
    await expectFetchError(
      fetchAllLeads({ env, fetchImpl: crossOrigin, sleep: noSleep }),
      "LEADS_PAGINATION_UNEXPECTED",
    );
  });

  it("detects pagination loops from repeated next URLs", async () => {
    const loopUrl = "https://leads.example.test/api/v1/leads/?page=2";
    // Fresh Response per call — a Response body is single-use.
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse(page([{ id: 1 }], 99, loopUrl))),
    );
    await expectFetchError(fetchAllLeads({ env, fetchImpl, sleep: noSleep }), "LEADS_PAGINATION_LOOP");
  });

  it("does not retry 401/403", async () => {
    for (const [status, code] of [
      [401, "LEADS_HTTP_UNAUTHORIZED"],
      [403, "LEADS_HTTP_FORBIDDEN"],
    ] as const) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: "no" }, status));
      const error = await expectFetchError(fetchAllLeads({ env, fetchImpl, sleep: noSleep }), code);
      expect(error.httpStatus).toBe(status);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("retries 429 and 5xx and succeeds on a later attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(page([{ id: 1 }], 1)));

    const result = await fetchAllLeads({ env, fetchImpl, sleep: noSleep, maxRetries: 2 });

    expect(result.leads).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("exhausts retries into deterministic rate-limit and server-error codes", async () => {
    const always429 = vi.fn().mockResolvedValue(jsonResponse({}, 429));
    await expectFetchError(
      fetchAllLeads({ env, fetchImpl: always429, sleep: noSleep, maxRetries: 1 }),
      "LEADS_HTTP_RATE_LIMITED",
    );
    expect(always429).toHaveBeenCalledTimes(2);

    const always503 = vi.fn().mockResolvedValue(jsonResponse({}, 503));
    const error = await expectFetchError(
      fetchAllLeads({ env, fetchImpl: always503, sleep: noSleep, maxRetries: 0 }),
      "LEADS_HTTP_SERVER_ERROR",
    );
    expect(error.httpStatus).toBe(503);
  });

  it("maps an aborted request to LEADS_TIMEOUT", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    await expectFetchError(
      fetchAllLeads({ env, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep, timeoutMs: 5, maxRetries: 0 }),
      "LEADS_TIMEOUT",
    );
  });

  it("maps rejected fetches to LEADS_NETWORK_ERROR and invalid bodies to LEADS_INVALID_JSON", async () => {
    const network = vi.fn().mockRejectedValue(new Error("ECONNRESET https://user:pass@host"));
    await expectFetchError(
      fetchAllLeads({ env, fetchImpl: network, sleep: noSleep, maxRetries: 0 }),
      "LEADS_NETWORK_ERROR",
    );

    const invalidJson = vi.fn().mockResolvedValue(new Response("<html>not json</html>", { status: 200 }));
    await expectFetchError(fetchAllLeads({ env, fetchImpl: invalidJson, sleep: noSleep }), "LEADS_INVALID_JSON");

    const notAList = vi.fn().mockResolvedValue(jsonResponse({ count: "x", results: "y" }));
    await expectFetchError(fetchAllLeads({ env, fetchImpl: notAList, sleep: noSleep }), "LEADS_INVALID_RESPONSE");
  });

  it("never leaks credentials or payload bodies through thrown errors", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: "secret client secret.client@applywizard.ai" }, 500));

    const error = await expectFetchError(
      fetchAllLeads({ env, fetchImpl, sleep: noSleep, maxRetries: 0 }),
      "LEADS_HTTP_SERVER_ERROR",
    );

    const serialized = JSON.stringify({ message: error.message, ...error });
    expect(error.message).toBe("LEADS_HTTP_SERVER_ERROR");
    expect(serialized).not.toContain("sync-user");
    expect(serialized).not.toContain("sync-password");
    expect(serialized).not.toContain("Basic ");
    expect(serialized).not.toContain("secret.client");
  });
});
