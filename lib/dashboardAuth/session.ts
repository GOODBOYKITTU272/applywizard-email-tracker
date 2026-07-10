import "server-only";

import { randomBytes } from "crypto";
import { hmacHex, verifyHmacHex } from "@/lib/dashboardAuth/config";

export function hashSessionToken(rawToken: string): string {
  return hmacHex(rawToken);
}

export function verifySessionToken(rawToken: string, storedHash: string): boolean {
  return verifyHmacHex(rawToken, storedHash);
}

export function generateRawSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
