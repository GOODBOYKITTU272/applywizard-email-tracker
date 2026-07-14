import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

import {
  buildHealthPayload,
  createWorkerState,
} from "@/worker/index";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("worker startup", () => {
  it("imports only worker-core sync and classify modules for processing", () => {
    const source = read("worker/index.ts");

    expect(source).toContain("@/lib/worker-core/syncTrackerMailbox");
    expect(source).toContain("@/lib/worker-core/classifyQueue");
    expect(source).not.toContain("server-only");
    expect(source).not.toContain("app/api/");
    expect(source).not.toContain("lib/zoho/syncEmails");
    expect(source).not.toContain("lib/zoho/classifyEmails");
  });

  it("reports degraded health when sync is stale after startup grace", () => {
    const state = createWorkerState();
    state.lastSyncAt = new Date("2026-07-01T00:00:00.000Z");

    const health = buildHealthPayload(
      state,
      new Date("2026-07-01T00:06:00.000Z"),
      0,
    );

    expect(health.httpStatus).toBe(503);
    expect(health.body.status).toBe("degraded");
  });

  it("reports degraded health when no sync completed after startup grace", () => {
    const state = createWorkerState(new Date("2026-07-01T00:00:00.000Z"));

    const health = buildHealthPayload(
      state,
      new Date("2026-07-01T00:02:01.000Z"),
    );

    expect(health.httpStatus).toBe(503);
    expect(health.body.status).toBe("degraded");
    expect(health.body.last_sync_at).toBeNull();
  });

  it("reports healthy after recent sync", () => {
    const state = createWorkerState();
    state.lastSyncAt = new Date("2026-07-01T00:04:30.000Z");
    state.lastClassifyAt = new Date("2026-07-01T00:04:45.000Z");
    state.classifyCheckedTotal = 7;
    state.classifyClassifiedTotal = 3;
    state.syncFetchedTotal = 11;

    const health = buildHealthPayload(
      state,
      new Date("2026-07-01T00:05:00.000Z"),
      0,
    );

    expect(health.httpStatus).toBe(200);
    expect(health.body).toMatchObject({
      status: "ok",
      last_sync_at: "2026-07-01T00:04:30.000Z",
      last_classify_at: "2026-07-01T00:04:45.000Z",
      classify_checked_total: 7,
      classify_classified_total: 3,
      sync_fetched_total: 11,
      error_count_last_hour: 0,
    });
  });
});
