import "server-only";

import type { NextResponse } from "next/server";

export const DASHBOARD_SESSION_COOKIE_NAME = "dashboard_session";
export const DASHBOARD_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 12;

function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export function setDashboardSessionCookie(response: NextResponse, sessionToken: string): void {
  response.cookies.set(
    DASHBOARD_SESSION_COOKIE_NAME,
    sessionToken,
    sessionCookieOptions(DASHBOARD_SESSION_COOKIE_MAX_AGE_SECONDS),
  );
}

export function clearDashboardSessionCookie(response: NextResponse): void {
  response.cookies.set(DASHBOARD_SESSION_COOKIE_NAME, "", sessionCookieOptions(0));
}
