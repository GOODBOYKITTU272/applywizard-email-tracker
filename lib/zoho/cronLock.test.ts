import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockDelete = vi.fn();
const mockInsert = vi.fn();

// Chainable builder returned by .from()
function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.delete = () => ({ eq: () => ({ lt: mockDelete, eq: mockDelete }) });
  chain.insert = mockInsert;
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({ from: () => makeChain() }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("cronLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("acquires lock when no active lock exists", async () => {
    mockInsert.mockResolvedValue({ error: null });
    const { acquireCronLock } = await import("./cronLock");
    expect(await acquireCronLock()).toBe(true);
  });

  it("returns false (skips) when another run holds the lock", async () => {
    mockInsert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });
    const { acquireCronLock } = await import("./cronLock");
    expect(await acquireCronLock()).toBe(false);
  });

  it("throws on unexpected DB error during acquire", async () => {
    mockInsert.mockResolvedValue({ error: { code: "42P01", message: "table missing" } });
    const { acquireCronLock } = await import("./cronLock");
    await expect(acquireCronLock()).rejects.toThrow("cron_locks insert failed");
  });

  it("releaseCronLock resolves without throwing", async () => {
    const { releaseCronLock } = await import("./cronLock");
    // delete chain resolves via mockDelete — default vi.fn() returns undefined
    mockDelete.mockResolvedValue({ error: null });
    await expect(releaseCronLock()).resolves.toBeUndefined();
  });

  it("stale lock is deleted before insert attempt", async () => {
    // Track whether delete was called before insert
    const callOrder: string[] = [];
    mockDelete.mockImplementation(() => {
      callOrder.push("delete");
      return Promise.resolve({ error: null });
    });
    mockInsert.mockImplementation(() => {
      callOrder.push("insert");
      return Promise.resolve({ error: null });
    });

    const { acquireCronLock } = await import("./cronLock");
    await acquireCronLock();

    expect(callOrder[0]).toBe("delete");
    expect(callOrder[1]).toBe("insert");
  });
});
