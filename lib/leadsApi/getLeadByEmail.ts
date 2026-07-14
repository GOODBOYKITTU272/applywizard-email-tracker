import "server-only";

export interface LeadMapping {
  clientName: string;
  assignedCaName: string;
  assignedCaEmail: string;
}

interface LeadApiRow {
  name?: unknown;
  email?: unknown;
  assigned_associate?: {
    name?: unknown;
    email?: unknown;
  };
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 4000;

const fallback: LeadMapping = {
  clientName: "Unmatched",
  assignedCaName: "Not mapped",
  assignedCaEmail: "-",
};

const cache = new Map<string, { expiresAt: number; result: LeadMapping }>();

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractRows(payload: unknown): LeadApiRow[] {
  if (Array.isArray(payload)) return payload as LeadApiRow[];
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.results)) return record.results as LeadApiRow[];
  if (Array.isArray(record.data)) return record.data as LeadApiRow[];

  const data = record.data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).results)) {
    return (data as Record<string, unknown>).results as LeadApiRow[];
  }

  return [];
}

function mapLead(payload: unknown, email: string): LeadMapping {
  const target = email.toLowerCase();
  const lead = extractRows(payload).find((row) => asString(row.email)?.toLowerCase() === target);
  if (!lead) return fallback;

  return {
    clientName: asString(lead.name) ?? fallback.clientName,
    assignedCaName: asString(lead.assigned_associate?.name) ?? fallback.assignedCaName,
    assignedCaEmail: asString(lead.assigned_associate?.email) ?? fallback.assignedCaEmail,
  };
}

async function fetchWithTimeout(url: URL, headers: HeadersInit): Promise<Response> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("LEADS_LOOKUP_TIMEOUT"));
    }, TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      fetch(url, {
        headers,
        signal: controller.signal,
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

export async function getLeadByEmail(email: string): Promise<LeadMapping> {
  const key = email.trim().toLowerCase();
  if (!key) return fallback;

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  let result = fallback;

  try {
    const baseUrl = process.env.LEADS_API_BASE_URL;
    const username = process.env.LEADS_API_USERNAME;
    const password = process.env.LEADS_API_PASSWORD;
    if (baseUrl && username && password) {
      const url = new URL(baseUrl);
      url.searchParams.set("search", key);

      const response = await fetchWithTimeout(url, {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        Accept: "application/json",
      });

      if (response.ok) {
        result = mapLead(await response.json(), key);
      }
    }
  } catch {
    result = fallback;
  }

  cache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    result,
  });

  return result;
}
