import "server-only";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
