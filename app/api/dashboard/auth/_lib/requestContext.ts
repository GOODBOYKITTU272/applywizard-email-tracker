import "server-only";

import { type NextRequest } from "next/server";

function truncate(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

function readHeaderValue(request: NextRequest, headerName: string, maxLength: number): string | undefined {
  const header = request.headers.get(headerName);
  if (!header) return undefined;

  const trimmed = header.trim();
  if (!trimmed) return undefined;

  return truncate(trimmed, maxLength);
}

export function extractRequestContext(request: NextRequest): {
  ip?: string;
  userAgent?: string;
} {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstEntry = forwardedFor.split(",")[0]?.trim();
    if (firstEntry) {
      return {
        ip: truncate(firstEntry, 256),
        userAgent: readHeaderValue(request, "user-agent", 512),
      };
    }
  }

  return {
    ip: readHeaderValue(request, "x-real-ip", 256),
    userAgent: readHeaderValue(request, "user-agent", 512),
  };
}
