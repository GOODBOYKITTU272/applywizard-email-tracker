import { type NextRequest, NextResponse } from "next/server";

import { clearDashboardSessionCookie, DASHBOARD_SESSION_COOKIE_NAME } from "@/lib/dashboardAuth/sessionCookie";
import { revokeDashboardSession } from "@/lib/dashboardAuth/sessionStore";

function invalidResponse(): NextResponse {
  return NextResponse.json({ ok: false }, { status: 400 });
}

function originMatchesRequest(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!originMatchesRequest(request)) {
    return invalidResponse();
  }

  const rawSessionToken = request.cookies.get(DASHBOARD_SESSION_COOKIE_NAME)?.value;
  if (rawSessionToken) {
    try {
      await revokeDashboardSession(rawSessionToken);
    } catch {
      // Logout is idempotent; revocation uncertainty must not leak or block cookie clearing.
    }
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  clearDashboardSessionCookie(response);
  return response;
}
