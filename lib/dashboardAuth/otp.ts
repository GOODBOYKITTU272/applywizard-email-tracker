import "server-only";

import { randomInt } from "crypto";
import { hmacHex, verifyHmacHex } from "@/lib/dashboardAuth/config";

export function hashOtp(rawOtp: string): string {
  return hmacHex(rawOtp);
}

export function verifyOtp(rawOtp: string, storedHash: string): boolean {
  return verifyHmacHex(rawOtp, storedHash);
}

export function generateRawOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
