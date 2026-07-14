import { describe, expect, it } from "vitest";

import {
  PREVIEW_DEMO_CHECKPOINT_MAILBOX,
  PREVIEW_DEMO_MARKER,
  buildPreviewDemoDataset,
  type PreviewDemoStatus,
} from "./dataset";
import {
  PREVIEW_DEMO_CHECKPOINT_CLEANUP,
  PREVIEW_DEMO_EMAIL_CLEANUP,
  resolvePreviewDemoGuard,
} from "../../scripts/preview-demo/seed-preview-demo";

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayStart(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function countInUtcDay(emails: { received_at: string }[], dayStartMs: number): number {
  return emails.filter((row) => {
    const t = new Date(row.received_at).getTime();
    return t >= dayStartMs && t < dayStartMs + DAY_MS;
  }).length;
}

const NOW = new Date("2026-07-13T12:00:00.000Z");
const ALLOWED_STATUSES: PreviewDemoStatus[] = [
  "pending",
  "processing",
  "retry_scheduled",
  "classified",
  "review",
  "dead_letter",
  "historical_ingested",
];
const ALLOWED_PRIORITIES = new Set([null, "critical", "high", "normal", "low"]);
const ALLOWED_ROUTING = new Set(["pending", "routed", "unroutable", "unmatched", "internal"]);

describe("preview demo dataset", () => {
  const { emails, checkpoint, marker } = buildPreviewDemoDataset(NOW);

  it("produces roughly 20-30 marked synthetic rows plus one checkpoint", () => {
    expect(emails.length).toBeGreaterThanOrEqual(20);
    expect(emails.length).toBeLessThanOrEqual(30);
    expect(marker).toBe(PREVIEW_DEMO_MARKER);
    expect(checkpoint.last_seen_message_id).toBe(PREVIEW_DEMO_MARKER);
    expect(checkpoint.mailbox_email).toBe(PREVIEW_DEMO_CHECKPOINT_MAILBOX);
    expect(checkpoint.last_successful_sync_at).toBeTruthy();
  });

  it("marks every row and uses only synthetic identifiers", () => {
    for (const row of emails) {
      expect(row.folder_id).toBe(PREVIEW_DEMO_MARKER);
      expect(row.message_id.startsWith("preview-demo-")).toBe(true);
      expect(row.mailbox_email.endsWith("@example.test")).toBe(true);
      expect(row.sender.endsWith(".example.test")).toBe(true);
    }
  });

  it("contains no real-looking PII or reserved production domains", () => {
    const blob = JSON.stringify(emails).toLowerCase();
    for (const banned of ["applywizz", "applywizard", "@gmail", "@outlook", "zoho", "nkkfsrhfttixwjbglhgg"]) {
      expect(blob).not.toContain(banned);
    }
  });

  it("respects enum/check constraints for status, priority, and routing", () => {
    for (const row of emails) {
      expect(ALLOWED_STATUSES).toContain(row.classification_status);
      expect(ALLOWED_PRIORITIES.has(row.priority as string | null)).toBe(true);
      expect(ALLOWED_ROUTING.has(row.routing_status)).toBe(true);
      expect(["incoming", "outgoing"]).toContain(row.email_direction);
    }
  });

  it("covers every dashboard queue/status and a deadline-tomorrow item", () => {
    const statuses = new Set(emails.map((row) => row.classification_status));
    for (const required of ["pending", "processing", "retry_scheduled", "classified", "review", "dead_letter"]) {
      expect(statuses.has(required as PreviewDemoStatus)).toBe(true);
    }
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(emails.some((row) => row.deadline === tomorrow)).toBe(true);
  });

  it("always places at least one row in UTC today and one in UTC yesterday", () => {
    const startToday = utcDayStart(NOW);
    expect(countInUtcDay(emails, startToday)).toBeGreaterThanOrEqual(1);
    expect(countInUtcDay(emails, startToday - DAY_MS)).toBeGreaterThanOrEqual(1);
  });

  it("keeps UTC today/yesterday coverage at midnight boundaries", () => {
    for (const iso of ["2026-07-13T00:00:30.000Z", "2026-07-13T23:59:30.000Z", "2026-07-13T12:00:00.000Z"]) {
      const now = new Date(iso);
      const built = buildPreviewDemoDataset(now).emails;
      const startToday = utcDayStart(now);
      expect(countInUtcDay(built, startToday)).toBeGreaterThanOrEqual(1);
      expect(countInUtcDay(built, startToday - DAY_MS)).toBeGreaterThanOrEqual(1);
      // "Today" rows must never be in the future.
      const maxReceived = Math.max(...built.map((row) => new Date(row.received_at).getTime()));
      expect(maxReceived).toBeLessThanOrEqual(now.getTime());
    }
  });

  it("spreads received_at across last 7 days, last 30 days, and older", () => {
    const ageDays = (iso: string) => (NOW.getTime() - new Date(iso).getTime()) / DAY_MS;
    const ages = emails.map((row) => ageDays(row.received_at));
    expect(ages.some((d) => d >= 2 && d < 7)).toBe(true);
    expect(ages.some((d) => d >= 7 && d < 30)).toBe(true);
    expect(ages.some((d) => d >= 30)).toBe(true);
  });

  it("populates a valid synthetic original_recipient on every row", () => {
    for (const row of emails) {
      expect(row.original_recipient).toBeTruthy();
      expect(row.original_recipient.endsWith("@example.test")).toBe(true);
    }
    const distinct = new Set(emails.map((row) => row.original_recipient));
    expect(distinct.size).toBeGreaterThanOrEqual(2);
  });

  it("sets classified_at only on classified rows and queue timestamps on their statuses", () => {
    for (const row of emails) {
      if (row.classification_status === "classified") {
        expect(row.classified_at).toBeTruthy();
      }
      if (row.classification_status === "retry_scheduled") expect(row.next_retry_at).toBeTruthy();
      if (row.classification_status === "processing") expect(row.claim_expires_at).toBeTruthy();
      if (row.classification_status === "dead_letter") expect(row.dead_lettered_at).toBeTruthy();
    }
  });
});

describe("preview demo guard", () => {
  const base = {
    SUPABASE_PROJECT_REF: "obirkjbzpykoehxacaaj",
    NEXT_PUBLIC_SUPABASE_URL: "https://obirkjbzpykoehxacaaj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-key",
  } as NodeJS.ProcessEnv;

  it("passes for the Preview project", () => {
    expect(resolvePreviewDemoGuard(base)).toEqual({ ok: true });
  });

  it("refuses when the declared project ref is not Preview", () => {
    expect(resolvePreviewDemoGuard({ ...base, SUPABASE_PROJECT_REF: "" })).toEqual({
      ok: false,
      code: "SUPABASE_PROJECT_REF_NOT_PREVIEW",
    });
  });

  it("refuses when the Supabase URL points at Production", () => {
    expect(
      resolvePreviewDemoGuard({
        ...base,
        SUPABASE_PROJECT_REF: "obirkjbzpykoehxacaaj",
        NEXT_PUBLIC_SUPABASE_URL: "https://nkkfsrhfttixwjbglhgg.supabase.co",
      }),
    ).toEqual({ ok: false, code: "REFUSING_PRODUCTION" });
  });

  it("refuses when the service-role key is missing", () => {
    expect(resolvePreviewDemoGuard({ ...base, SUPABASE_SERVICE_ROLE_KEY: "" })).toEqual({
      ok: false,
      code: "MISSING_SERVICE_ROLE_KEY",
    });
  });
});

describe("preview demo cleanup scoping", () => {
  it("scopes email cleanup strictly to the marker", () => {
    expect(PREVIEW_DEMO_EMAIL_CLEANUP).toEqual({ column: "folder_id", value: PREVIEW_DEMO_MARKER });
  });

  it("limits checkpoint cleanup to the marker AND the synthetic checkpoint identity", () => {
    const byColumn = Object.fromEntries(PREVIEW_DEMO_CHECKPOINT_CLEANUP.map((f) => [f.column, f.value]));
    expect(byColumn.last_seen_message_id).toBe(PREVIEW_DEMO_MARKER);
    expect(byColumn.mailbox_email).toBe(PREVIEW_DEMO_CHECKPOINT_MAILBOX);
    // Exactly these two narrowing conditions — nothing broader.
    expect(PREVIEW_DEMO_CHECKPOINT_CLEANUP).toHaveLength(2);
  });
});
