import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PATHS = [
  "/dashboard",
  "/overview",
  "/live-monitor",
  "/clients",
  "/operations",
  "/review-queue",
];

/**
 * Constant-time comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    const authorization = request.headers.get("authorization");
    const expectedSecret = process.env.DASHBOARD_SECRET;

    // Fail closed if the secret is not configured on the server
    if (!expectedSecret) {
      return new NextResponse("Unauthorized: DASHBOARD_SECRET is not configured on the server.", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="ApplyWizard Dashboard"',
        },
      });
    }

    if (authorization) {
      const basicAuth = authorization.split(" ")[1];
      if (basicAuth) {
        try {
          const decoded = atob(basicAuth);
          const parts = decoded.split(":");
          const username = parts[0] || "";
          const password = parts.slice(1).join(":"); // Handles passwords containing colons

          const usernameMatch = safeCompare(username, "admin");
          const passwordMatch = safeCompare(password, expectedSecret);

          if (usernameMatch && passwordMatch) {
            return NextResponse.next();
          }
        } catch {
          // Ignore base64 decoding errors
        }
      }
    }

    // Default 401 challenge response
    return new NextResponse("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="ApplyWizard Dashboard"',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/overview",
    "/live-monitor",
    "/live-monitor/:path*",
    "/clients/:path*",
    "/operations/:path*",
    "/review-queue",
  ],
};
