import { type NextRequest, NextResponse } from "next/server";
import { verifyDashboardLoginTotp } from "@/lib/dashboardAuth/authFlow";
import { setDashboardSessionCookie } from "@/lib/dashboardAuth/sessionCookie";
import { extractRequestContext } from "../_lib/requestContext";

const MAX_BODY_BYTES = 8192;
const MAX_CHALLENGE_LENGTH = 2048;
const MAX_CODE_LENGTH = 10;

function invalidResponse(status = 400): NextResponse {
  return NextResponse.json({ ok: false }, { status });
}

function readRequestBodySize(request: NextRequest): number | null {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return null;
  const parsed = Number(contentLength);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStringField(body: Record<string, unknown>, key: "challenge" | "code", maxLength: number): string | null {
  const value = body[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const contentLength = readRequestBodySize(request);
    if (contentLength !== null && contentLength > MAX_BODY_BYTES) {
      return invalidResponse();
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidResponse();
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return invalidResponse();
    }

    const record = body as Record<string, unknown>;
    const challenge = readStringField(record, "challenge", MAX_CHALLENGE_LENGTH);
    const code = readStringField(record, "code", MAX_CODE_LENGTH);
    if (!challenge || !code) {
      return invalidResponse();
    }

    const { ip, userAgent } = extractRequestContext(request);
    const result = await verifyDashboardLoginTotp({ challenge, code, ip, userAgent });
    if (!result.ok) {
      return invalidResponse();
    }

    const response = NextResponse.json({ ok: true }, { status: 200 });
    setDashboardSessionCookie(response, result.sessionToken);
    return response;
  } catch {
    return invalidResponse();
  }
}
