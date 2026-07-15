// fetchLeads — authenticated fetch of the complete filtered Leads API user list
// (Live Monitor V1, Phase S2).
//
// Secret-safe by construction: the Basic Authorization header is built at
// runtime from env vars, lives only in the request, and never appears in
// errors, logs, or return values. Thrown errors carry a deterministic code
// (plus HTTP status) — never credentials or response bodies.

import type { LeadsApiLead, LeadsApiListResponse } from "@/lib/leadsSync/types";

export const LEADS_FILTER_PARAMS: Readonly<Record<string, string>> = {
  page_size: "all",
  status: "In Progress",
  services_opted: "applications",
  services_opted_logic: "and",
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1_000;
// ponytail: page_size=all means one page today; the cap only bounds a future
// paginated API from running away.
const MAX_PAGES = 50;

export type LeadsFetchErrorCode =
  | "LEADS_AUTH_MISSING"
  | "LEADS_CONFIG_INVALID"
  | "LEADS_HTTP_UNAUTHORIZED"
  | "LEADS_HTTP_FORBIDDEN"
  | "LEADS_HTTP_RATE_LIMITED"
  | "LEADS_HTTP_SERVER_ERROR"
  | "LEADS_TIMEOUT"
  | "LEADS_NETWORK_ERROR"
  | "LEADS_INVALID_JSON"
  | "LEADS_INVALID_RESPONSE"
  | "LEADS_COUNT_MISMATCH"
  | "LEADS_PAGINATION_UNEXPECTED"
  | "LEADS_PAGINATION_LOOP";

export class LeadsFetchError extends Error {
  readonly code: LeadsFetchErrorCode;
  readonly httpStatus: number | null;

  constructor(code: LeadsFetchErrorCode, httpStatus: number | null = null) {
    // The message IS the code — deterministic and safe to log anywhere.
    super(code);
    this.name = "LeadsFetchError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface FetchLeadsResult {
  leads: LeadsApiLead[];
  declaredCount: number;
  httpStatus: number;
  pages: number;
}

export interface FetchLeadsOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function buildFirstPageUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new LeadsFetchError("LEADS_CONFIG_INVALID");
  }
  for (const [key, value] of Object.entries(LEADS_FILTER_PARAMS)) {
    url.searchParams.set(key, value);
  }
  return url;
}

/** Retryable failure inside a single page request. Internal only. */
interface RetryableFailure {
  code: LeadsFetchErrorCode;
  httpStatus: number | null;
}

async function requestPage(
  url: string,
  authorization: string,
  options: Required<Pick<FetchLeadsOptions, "timeoutMs" | "maxRetries" | "retryDelayMs">> & {
    fetchImpl: typeof fetch;
    sleep: (ms: number) => Promise<void>;
  },
): Promise<{ payload: LeadsApiListResponse; httpStatus: number }> {
  let lastFailure: RetryableFailure = { code: "LEADS_NETWORK_ERROR", httpStatus: null };

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    if (attempt > 0) await options.sleep(options.retryDelayMs * 2 ** (attempt - 1));

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);

    let response: Response;
    try {
      response = await options.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: authorization },
        signal: controller.signal,
      });
    } catch {
      // Never surface the underlying error — it can embed the request URL/headers.
      lastFailure = { code: timedOut ? "LEADS_TIMEOUT" : "LEADS_NETWORK_ERROR", httpStatus: null };
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401) throw new LeadsFetchError("LEADS_HTTP_UNAUTHORIZED", 401);
    if (response.status === 403) throw new LeadsFetchError("LEADS_HTTP_FORBIDDEN", 403);
    if (response.status === 429) {
      lastFailure = { code: "LEADS_HTTP_RATE_LIMITED", httpStatus: 429 };
      continue;
    }
    if (response.status >= 500) {
      lastFailure = { code: "LEADS_HTTP_SERVER_ERROR", httpStatus: response.status };
      continue;
    }
    if (!response.ok) throw new LeadsFetchError("LEADS_INVALID_RESPONSE", response.status);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new LeadsFetchError("LEADS_INVALID_JSON", response.status);
    }
    if (!payload || typeof payload !== "object") {
      throw new LeadsFetchError("LEADS_INVALID_RESPONSE", response.status);
    }
    return { payload: payload as LeadsApiListResponse, httpStatus: response.status };
  }

  throw new LeadsFetchError(lastFailure.code, lastFailure.httpStatus);
}

/**
 * Fetch the complete filtered leads list. Follows `next` links if the API ever
 * paginates (same-origin only, loop-guarded), then requires the accumulated
 * result length to equal the declared `count`.
 */
export async function fetchAllLeads(options: FetchLeadsOptions = {}): Promise<FetchLeadsResult> {
  const env = options.env ?? process.env;
  const baseUrl = env.LEADS_API_BASE_URL?.trim();
  const username = env.LEADS_API_USERNAME?.trim();
  const password = env.LEADS_API_PASSWORD?.trim();
  if (!baseUrl || !username || !password) throw new LeadsFetchError("LEADS_AUTH_MISSING");

  const requestOptions = {
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    sleep: options.sleep ?? defaultSleep,
  };

  const firstUrl = buildFirstPageUrl(baseUrl);
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  const leads: LeadsApiLead[] = [];
  const visited = new Set<string>();
  let nextUrl: string | null = firstUrl.toString();
  let declaredCount: number | null = null;
  let httpStatus = 0;
  let pages = 0;

  while (nextUrl) {
    if (visited.has(nextUrl)) throw new LeadsFetchError("LEADS_PAGINATION_LOOP");
    visited.add(nextUrl);
    if (++pages > MAX_PAGES) throw new LeadsFetchError("LEADS_PAGINATION_UNEXPECTED");

    const { payload, httpStatus: status } = await requestPage(nextUrl, authorization, requestOptions);
    httpStatus = status;

    if (!Array.isArray(payload.results) || typeof payload.count !== "number") {
      throw new LeadsFetchError("LEADS_INVALID_RESPONSE", status);
    }
    if (declaredCount === null) declaredCount = payload.count;
    leads.push(...(payload.results as LeadsApiLead[]));

    if (payload.next === null || payload.next === undefined) {
      nextUrl = null;
    } else if (typeof payload.next === "string") {
      let parsedNext: URL;
      try {
        parsedNext = new URL(payload.next);
      } catch {
        throw new LeadsFetchError("LEADS_PAGINATION_UNEXPECTED", status);
      }
      if (parsedNext.origin !== firstUrl.origin) {
        throw new LeadsFetchError("LEADS_PAGINATION_UNEXPECTED", status);
      }
      nextUrl = parsedNext.toString();
    } else {
      throw new LeadsFetchError("LEADS_PAGINATION_UNEXPECTED", status);
    }
  }

  if (declaredCount === null || leads.length !== declaredCount) {
    throw new LeadsFetchError("LEADS_COUNT_MISMATCH", httpStatus);
  }

  return { leads, declaredCount, httpStatus, pages };
}
