import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  SAFE_REASON_FALLBACK,
  UNSAFE_REASON_SQL_PATTERN,
  reasonMatchesUnsafePolicy,
} from "@/lib/classify/sanitizeReason";

import {
  claimEmailsForClassification,
  getFinalClassificationStatus,
  getRetryDisposition,
  getSafeProcessingError,
  updateClaimedEmail,
} from "@/lib/zoho/queueFoundation";

describe("queueFoundation", () => {
  it("uses the approved retry schedule and dead-letters on the fifth failure", () => {
    expect(getRetryDisposition(1, "2026-06-30T04:00:00.000Z")).toEqual({
      status: "retry_scheduled",
      nextRetryAt: "2026-06-30T04:01:00.000Z",
      deadLetteredAt: null,
    });
    expect(getRetryDisposition(2, "2026-06-30T04:00:00.000Z")).toEqual({
      status: "retry_scheduled",
      nextRetryAt: "2026-06-30T04:05:00.000Z",
      deadLetteredAt: null,
    });
    expect(getRetryDisposition(3, "2026-06-30T04:00:00.000Z")).toEqual({
      status: "retry_scheduled",
      nextRetryAt: "2026-06-30T04:15:00.000Z",
      deadLetteredAt: null,
    });
    expect(getRetryDisposition(4, "2026-06-30T04:00:00.000Z")).toEqual({
      status: "retry_scheduled",
      nextRetryAt: "2026-06-30T05:00:00.000Z",
      deadLetteredAt: null,
    });
    expect(getRetryDisposition(5, "2026-06-30T04:00:00.000Z")).toEqual({
      status: "dead_letter",
      nextRetryAt: null,
      deadLetteredAt: "2026-06-30T04:00:00.000Z",
    });
  });

  it("claims rows through the database function with mailbox, worker id, limit, and ttl", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: "email-1" }], error: null });
    const rows = await claimEmailsForClassification(
      { rpc } as unknown as { rpc: typeof rpc },
      "tracker@applywizard.ai",
      "worker-a",
      25,
    );

    expect(rows).toEqual([{ id: "email-1" }]);
    expect(rpc).toHaveBeenCalledWith("claim_zoho_email_rows", {
      p_mailbox_email: "tracker@applywizard.ai",
      p_worker_id: "worker-a",
      p_limit: 25,
      p_claim_ttl_seconds: 600,
    });
  });

  it("supports two workers claiming independently through the atomic database function", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "email-1" }], error: null })
      .mockResolvedValueOnce({ data: [{ id: "email-2" }], error: null });

    const first = await claimEmailsForClassification(
      { rpc } as unknown as { rpc: typeof rpc },
      "tracker@applywizard.ai",
      "worker-a",
      1,
    );
    const second = await claimEmailsForClassification(
      { rpc } as unknown as { rpc: typeof rpc },
      "tracker@applywizard.ai",
      "worker-b",
      1,
    );

    expect(first).toEqual([{ id: "email-1" }]);
    expect(second).toEqual([{ id: "email-2" }]);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_worker_id: "worker-b" });
  });

  it("maps needs_human_review rows to real review status", () => {
    expect(getFinalClassificationStatus(true)).toBe("review");
    expect(getFinalClassificationStatus(false)).toBe("classified");
  });

  it("uses fixed safe error messages and never stores raw exception text", () => {
    const aiJson = getSafeProcessingError({
      stage: "ai",
      error: new Error("AI returned invalid JSON. Cannot parse classification result."),
    });
    expect(aiJson).toEqual({
      code: "AI_INVALID_JSON",
      message: "AI returned invalid JSON.",
    });

    const timeout = getSafeProcessingError({
      stage: "ai",
      error: new Error("ETIMEDOUT from provider with https://secret.example/token and otp 123456"),
    });
    expect(timeout).toEqual({
      code: "AI_TIMEOUT",
      message: "AI request timed out.",
    });
    expect(timeout.message).not.toContain("https://");
    expect(timeout.message).not.toContain("123456");
  });

  it("rejects stale worker writes after the claim lease expires", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const gt = vi.fn(() => ({ select: () => ({ maybeSingle }) }));
    const eqStatus = vi.fn(() => ({ gt }));
    const eqWorker = vi.fn(() => ({ eq: eqStatus }));
    const eqId = vi.fn(() => ({ eq: eqWorker }));
    const update = vi.fn(() => ({ eq: eqId }));
    const from = vi.fn(() => ({ update }));

    const updated = await updateClaimedEmail(
      { from } as unknown as { from: typeof from },
      {
        id: "email-1",
        workerId: "worker-a",
        nowIso: "2026-06-30T04:00:00.000Z",
        payload: { classification_status: "classified" },
      },
    );

    expect(updated).toBe(false);
    expect(eqWorker).toHaveBeenCalledWith("claimed_by", "worker-a");
    expect(eqStatus).toHaveBeenCalledWith("classification_status", "processing");
    expect(gt).toHaveBeenCalledWith("claim_expires_at", "2026-06-30T04:00:00.000Z");
  });

  it("migration enforces skip-locked claims so concurrent workers cannot grab the same row", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202606300001_queue_foundation.sql"),
      "utf8",
    );

    expect(migration).toContain("for update skip locked");
  });

  it("migration safely converts legacy failed rows before the new constraint is added", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202606300001_queue_foundation.sql"),
      "utf8",
    );

    expect(migration).toContain("where classification_status = 'failed'");
    expect(migration).toContain("classification_status = 'retry_scheduled'");
    expect(migration).toContain("next_retry_at = now()");
  });

  it("migration claims pending, due retry, and expired processing rows atomically", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202606300001_queue_foundation.sql"),
      "utf8",
    );

    expect(migration).toContain("classification_status = 'pending'");
    expect(migration).toContain("classification_status = 'retry_scheduled'");
    expect(migration).toContain("next_retry_at is null or next_retry_at <= p_now");
    expect(migration).toContain("classification_status = 'processing'");
    expect(migration).toContain("claim_expires_at is not null");
    expect(migration).toContain("claim_expires_at <= p_now");
    expect(migration).toContain("classification_status in ('pending', 'retry_scheduled', 'processing')");
    expect(migration).toContain("claim_expires_at is null or claim_expires_at <= p_now");
    expect(migration).toContain("for update skip locked");
  });

  it("migration does not steal active processing or future retry rows", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202606300001_queue_foundation.sql"),
      "utf8",
    );

    expect(migration).toContain("classification_status = 'processing'");
    expect(migration).toContain("and claim_expires_at <= p_now");
    expect(migration).toContain("claim_expires_at is null or claim_expires_at <= p_now");
    expect(migration).toContain("classification_status = 'retry_scheduled'");
    expect(migration).toContain("next_retry_at is null or next_retry_at <= p_now");
    expect(migration).not.toContain("next_retry_at > p_now");
  });

  it("corrective reason migration only redacts unsafe reasons and preserves classification fields", () => {
    const migration = readFileSync(
      resolve(__dirname, "../../supabase/migrations/202606300002_redact_unsafe_reasons.sql"),
      "utf8",
    );

    const rowBefore = {
      id: "row-1",
      reason: 'Provider output with access token marker and "quoted private excerpt"',
      category: "recruiter_reply",
      confidence: 0.82,
      classification_status: "review",
      classifier_source: "ai",
      claimed_by: "worker-a",
      claimed_at: "2026-06-30T04:00:00.000Z",
      claim_expires_at: "2026-06-30T04:10:00.000Z",
      original_recipient: "client@applywizard.ai",
      routing_status: "routed",
      updated_at: "2026-06-30T04:00:00.000Z",
    };
    const rowAfter = reasonMatchesUnsafePolicy(rowBefore.reason)
      ? { ...rowBefore, reason: SAFE_REASON_FALLBACK }
      : rowBefore;

    expect(migration).toContain("set reason = 'Classification reason redacted for safety.'");
    expect(migration).toContain("where reason is not null");
    expect(migration).toContain(UNSAFE_REASON_SQL_PATTERN);
    expect(migration).not.toMatch(/set\s+category\s*=/i);
    expect(migration).not.toMatch(/set\s+confidence\s*=/i);
    expect(migration).not.toMatch(/set\s+classification_status\s*=/i);
    expect(migration).not.toMatch(/set\s+classifier_source\s*=/i);
    expect(rowAfter.reason).toBe(SAFE_REASON_FALLBACK);
    expect({
      ...rowAfter,
      reason: rowBefore.reason,
    }).toEqual(rowBefore);
  });
});
