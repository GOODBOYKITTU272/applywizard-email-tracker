import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  LIVE_MONITOR_TEST_CA_EMAIL,
  LIVE_MONITOR_TEST_CLIENT_NAME,
  buildTestClientCleanupFilter,
  buildTestClientRow,
  normalizeRecipient,
  resolveLiveMonitorSeedGuard,
  resolveTestClientConfig,
} from "./testClient";
import { runSeedTestClientCli } from "../../scripts/live-monitor/seed-test-client";

const MIGRATION = readFileSync("supabase/migrations/202607140001_create_clients_table.sql", "utf8");

const baseEnv = {
  SUPABASE_PROJECT_REF: "obirkjbzpykoehxacaaj",
  NEXT_PUBLIC_SUPABASE_URL: "https://obirkjbzpykoehxacaaj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-key",
  LIVE_MONITOR_TEST_RECIPIENT: "Preview.Client@ApplyWizard.ai",
} as NodeJS.ProcessEnv;

// Records every DB operation so we can prove which modes write.
function fakeSupabase() {
  const ops: string[] = [];
  const chain = {
    eq: vi.fn((column: string, value: string) => {
      ops.push(`eq:${column}=${value}`);
      return chain;
    }),
    select: vi.fn(async () => ({ data: [{ id: "client-1" }], error: null })),
  };
  const client = {
    from: vi.fn((table: string) => ({
      upsert: vi.fn((row: Record<string, unknown>, options: { onConflict: string }) => {
        ops.push(`upsert:${table}:onConflict=${options.onConflict}:name=${String(row.client_name)}`);
        return { select: vi.fn(async () => ({ data: [{ id: "client-1" }], error: null })) };
      }),
      delete: vi.fn(() => {
        ops.push(`delete:${table}`);
        return chain;
      }),
    })),
  };
  return { client, ops };
}

describe("live monitor clients migration", () => {
  it("defines every required column", () => {
    for (const col of [
      "id uuid primary key",
      "client_name text not null",
      "recipient_email text not null",
      "recipient_email_normalized text generated always as (lower(trim(recipient_email))) stored",
      "assigned_ca_name text not null",
      "assigned_ca_email text not null",
      "is_active boolean not null default true",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
    ]) {
      expect(MIGRATION).toContain(col);
    }
  });

  it("makes the normalized recipient unique (its index serves lookups)", () => {
    expect(MIGRATION).toMatch(/unique \(recipient_email_normalized\)/);
  });

  it("adds the FK with ON DELETE SET NULL and keeps client_id nullable", () => {
    expect(MIGRATION).toMatch(/foreign key \(client_id\) references public\.clients\(id\) on delete set null/);
    expect(MIGRATION).not.toMatch(/client_id[^;]*set not null/i);
  });

  it("is additive — does not alter or delete existing email rows", () => {
    expect(MIGRATION).not.toMatch(/drop table|delete from|truncate/i);
  });
});

describe("live monitor seed guard and config", () => {
  it("accepts only the Preview project", () => {
    expect(resolveLiveMonitorSeedGuard(baseEnv)).toEqual({ ok: true });
  });

  it("rejects the Production ref before any client creation", () => {
    expect(
      resolveLiveMonitorSeedGuard({ ...baseEnv, NEXT_PUBLIC_SUPABASE_URL: "https://nkkfsrhfttixwjbglhgg.supabase.co" }),
    ).toEqual({ ok: false, code: "REFUSING_PRODUCTION" });
    expect(resolveLiveMonitorSeedGuard({ ...baseEnv, SUPABASE_PROJECT_REF: "nkkfsrhfttixwjbglhgg" })).toEqual({
      ok: false,
      code: "SUPABASE_PROJECT_REF_NOT_PREVIEW",
    });
  });

  it("normalizes uppercase and surrounding whitespace", () => {
    expect(normalizeRecipient("  Preview.Client@ApplyWizard.AI  ")).toBe("preview.client@applywizard.ai");
  });

  it("fails safely when LIVE_MONITOR_TEST_RECIPIENT is missing", () => {
    expect(resolveTestClientConfig({ ...baseEnv, LIVE_MONITOR_TEST_RECIPIENT: "" })).toEqual({
      ok: false,
      code: "MISSING_RECIPIENT",
    });
  });

  it("uses synthetic-only fixture identities (CA email on example.test)", () => {
    expect(LIVE_MONITOR_TEST_CA_EMAIL.endsWith("@example.test")).toBe(true);
    const row = buildTestClientRow("preview.client@applywizard.ai");
    expect(row.assigned_ca_email).toBe(LIVE_MONITOR_TEST_CA_EMAIL);
    expect(row.client_name).toBe(LIVE_MONITOR_TEST_CLIENT_NAME);
    // No hard-coded deliverable recipient in the row builder — it comes from the arg.
    expect(row.recipient_email).toBe("preview.client@applywizard.ai");
  });

  it("scopes cleanup to the exact synthetic marker and normalized recipient", () => {
    const filter = buildTestClientCleanupFilter("preview.client@applywizard.ai");
    const byColumn = Object.fromEntries(filter.map((f) => [f.column, f.value]));
    expect(byColumn.recipient_email_normalized).toBe("preview.client@applywizard.ai");
    expect(byColumn.client_name).toBe(LIVE_MONITOR_TEST_CLIENT_NAME);
    expect(byColumn.assigned_ca_email).toBe(LIVE_MONITOR_TEST_CA_EMAIL);
    expect(filter).toHaveLength(3);
  });
});

describe("live monitor seed runner", () => {
  it("dry-run performs no writes", async () => {
    const { client, ops } = fakeSupabase();
    const res = await runSeedTestClientCli([], baseEnv, {
      createSupabase: () => client as never,
      logger: { info: () => {}, error: () => {} },
    });
    expect(res).toEqual({ ok: true, mode: "dry-run", affected: 0 });
    expect(ops).toEqual([]); // never even created a query
    expect(client.from).not.toHaveBeenCalled();
  });

  it("apply upserts idempotently on the normalized column", async () => {
    const { client, ops } = fakeSupabase();
    const res = await runSeedTestClientCli(["--apply"], baseEnv, {
      createSupabase: () => client as never,
      logger: { info: () => {}, error: () => {} },
    });
    expect(res).toEqual({ ok: true, mode: "apply", affected: 1 });
    expect(ops).toContain("upsert:clients:onConflict=recipient_email_normalized:name=Preview Test Client");
    expect(ops.some((o) => o.startsWith("delete"))).toBe(false);
  });

  it("cleanup deletes only the exact marked synthetic client", async () => {
    const { client, ops } = fakeSupabase();
    const res = await runSeedTestClientCli(["--cleanup"], baseEnv, {
      createSupabase: () => client as never,
      logger: { info: () => {}, error: () => {} },
    });
    expect(res).toEqual({ ok: true, mode: "cleanup", affected: 1 });
    expect(ops).toContain("delete:clients");
    expect(ops).toContain("eq:recipient_email_normalized=preview.client@applywizard.ai");
    expect(ops).toContain(`eq:client_name=${LIVE_MONITOR_TEST_CLIENT_NAME}`);
    expect(ops).toContain(`eq:assigned_ca_email=${LIVE_MONITOR_TEST_CA_EMAIL}`);
  });

  it("refuses before touching Supabase when the recipient is missing", async () => {
    const { client } = fakeSupabase();
    const res = await runSeedTestClientCli(["--apply"], { ...baseEnv, LIVE_MONITOR_TEST_RECIPIENT: "" }, {
      createSupabase: () => client as never,
      logger: { info: () => {}, error: () => {} },
    });
    expect(res).toEqual({ ok: false, code: "MISSING_RECIPIENT" });
    expect(client.from).not.toHaveBeenCalled();
  });
});
