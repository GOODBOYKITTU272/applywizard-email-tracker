import "server-only";

import { timingSafeEqual } from "crypto";
import { type NextRequest, NextResponse } from "next/server";

const BASIC_AUTH_REALM = 'Basic realm="ApplyWizard Dashboard"';
const DASHBOARD_USERNAME = "admin";

function toBuffer(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = toBuffer(actual);
  const expectedBuffer = toBuffer(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { ok: false },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": BASIC_AUTH_REALM,
      },
    },
  );
}

export function requireDashboardBasicAuth(request: NextRequest): NextResponse | null {
  const dashboardSecret = process.env.DASHBOARD_SECRET;
  if (!dashboardSecret) {
    return unauthorizedResponse();
  }

  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Basic\s+/i.test(authorization)) {
    return unauthorizedResponse();
  }

  const encoded = authorization.replace(/^Basic\s+/i, "").trim();
  if (!encoded) {
    return unauthorizedResponse();
  }

  let decoded = "";
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return unauthorizedResponse();
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return unauthorizedResponse();
  }

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  if (!safeEqual(username, DASHBOARD_USERNAME)) {
    return unauthorizedResponse();
  }

  if (!safeEqual(password, dashboardSecret)) {
    return unauthorizedResponse();
  }

  return null;
}
