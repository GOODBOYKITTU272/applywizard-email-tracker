import { type NextRequest, NextResponse } from "next/server";
import { requestDashboardLoginOtp } from "@/lib/dashboardAuth/authFlow";
import { requireDashboardBasicAuth } from "../_lib/basicAuthGate";
import { extractRequestContext } from "../_lib/requestContext";

const MAX_BODY_BYTES = 8192;
const MAX_EMAIL_LENGTH = 254;

function invalidResponse(status = 400): NextResponse {
  return NextResponse.json({ ok: false }, { status });
}

function readRequestBodySize(request: NextRequest): number | null {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return null;

  const parsed = Number(contentLength);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseEmail(body: Record<string, unknown>): string | null {
  const value = body.email;
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  return email;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authFailure = requireDashboardBasicAuth(request);
  if (authFailure) return authFailure;

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

    const email = parseEmail(body as Record<string, unknown>);
    if (!email) {
      return invalidResponse();
    }

    const { ip, userAgent } = extractRequestContext(request);
    const result = await requestDashboardLoginOtp({ email, ip, userAgent });

    if (!result.ok) {
      return invalidResponse();
    }

    return NextResponse.json({ ok: true, otpId: result.otpId }, { status: 200 });
  } catch {
    return invalidResponse();
  }
}
