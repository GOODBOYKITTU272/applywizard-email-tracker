import { type NextRequest, NextResponse } from "next/server";
import { verifyDashboardLoginOtp } from "@/lib/dashboardAuth/authFlow";
import { extractRequestContext } from "../_lib/requestContext";

const MAX_BODY_BYTES = 8192;
const MAX_OTP_ID_LENGTH = 128;
const MAX_RAW_OTP_LENGTH = 32;

function invalidResponse(status = 400): NextResponse {
  return NextResponse.json({ ok: false }, { status });
}

function readRequestBodySize(request: NextRequest): number | null {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return null;
  const parsed = Number(contentLength);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStringField(body: Record<string, unknown>, key: "otpId" | "rawOtp", maxLength: number): string | null {
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
    const otpId = readStringField(record, "otpId", MAX_OTP_ID_LENGTH);
    const rawOtp = readStringField(record, "rawOtp", MAX_RAW_OTP_LENGTH);
    if (!otpId || !rawOtp) {
      return invalidResponse();
    }

    const { ip, userAgent } = extractRequestContext(request);
    const result = await verifyDashboardLoginOtp({ otpId, rawOtp, ip, userAgent });
    if (!result.ok) {
      return invalidResponse();
    }

    if (result.stage === "totp_setup_required") {
      return NextResponse.json(
        {
          ok: true,
          stage: "totp_setup_required",
          challenge: result.challenge,
          totpSecret: result.totpSecret,
          provisioningUri: result.provisioningUri,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        stage: "totp_required",
        challenge: result.challenge,
      },
      { status: 200 },
    );
  } catch {
    return invalidResponse();
  }
}
