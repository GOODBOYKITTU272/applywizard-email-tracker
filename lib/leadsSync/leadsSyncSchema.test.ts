import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const clientsSql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/202607150001_extend_clients_for_leads_sync.sql"),
  "utf8",
);
const runsSql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/202607150002_create_client_sync_runs.sql"),
  "utf8",
);
const lockSql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/202607150003_add_cron_lock_owner_token.sql"),
  "utf8",
);

describe("202607150001_extend_clients_for_leads_sync", () => {
  it("adds every sync column additively", () => {
    for (const column of [
      "external_client_id text",
      "source text not null default 'leads_api'",
      "contact_email text",
      "source_status text",
      "is_recipient_mappable boolean not null default false",
      "assigned_ca_external_id text",
      "plan text",
      "target_role text",
      "years_experience integer",
      "location text",
      "number_of_applications text",
      "start_date date",
      "end_date date",
      "source_created_at timestamptz",
      "source_updated_at timestamptz",
      "last_synced_at timestamptz",
      "sync_generation uuid",
    ]) {
      expect(clientsSql).toContain(`add column ${column}`);
    }
  });

  it("relaxes recipient and CA columns to nullable", () => {
    expect(clientsSql).toContain("alter column recipient_email drop not null");
    expect(clientsSql).toContain("alter column assigned_ca_name drop not null");
    expect(clientsSql).toContain("alter column assigned_ca_email drop not null");
  });

  it("adds a non-partial unique constraint on (source, external_client_id) that PostgREST can target", () => {
    expect(clientsSql).toMatch(
      /add constraint clients_source_external_client_id_key\s+unique \(source, external_client_id\)/,
    );
    // Must NOT be partial: PostgREST cannot infer a partial index for
    // onConflict, and Postgres already allows multiple null external ids
    // (nulls are distinct) — so the pre-sync seed row stays valid.
    expect(clientsSql.toLowerCase()).not.toContain("where external_client_id is not null");
    expect(clientsSql.toLowerCase()).not.toContain("create unique index clients_source_external_id_unique");
  });

  it("keeps the sync upsert onConflict target aligned with the unique constraint", () => {
    const syncSource = readFileSync(resolve(__dirname, "syncClients.ts"), "utf8");
    expect(syncSource).toContain('"source,external_client_id"');
    expect(clientsSql).toContain("unique (source, external_client_id)");
  });

  it("adds the required indexes", () => {
    expect(clientsSql).toContain("create index clients_is_active_idx on public.clients (is_active)");
    expect(clientsSql).toContain(
      "create index clients_is_recipient_mappable_idx on public.clients (is_recipient_mappable)",
    );
    expect(clientsSql).toContain(
      "create index clients_assigned_ca_external_id_idx on public.clients (assigned_ca_external_id)",
    );
  });

  it("is strictly additive — never drops, deletes, or rewrites existing data", () => {
    const lowered = clientsSql.toLowerCase();
    expect(lowered).not.toContain("drop table");
    expect(lowered).not.toContain("drop column");
    expect(lowered).not.toContain("delete from");
    expect(lowered).not.toContain("truncate");
    expect(lowered).not.toContain("update public.clients");
    // The generated recipient_email_normalized column and its unique constraint
    // from 202607140001 are relied on, not recreated.
    expect(lowered).not.toContain("drop constraint");
  });
});

describe("202607150002_create_client_sync_runs", () => {
  it("creates every observability column", () => {
    for (const column of [
      "id uuid primary key",
      "source text not null",
      "environment text",
      "project_ref text",
      "started_at timestamptz not null",
      "completed_at timestamptz",
      "status text not null",
      "http_status integer",
      "declared_count integer",
      "fetched_count integer",
      "valid_count integer",
      "invalid_count integer",
      "inserted_count integer",
      "updated_count integer",
      "unchanged_count integer",
      "mappable_count integer",
      "contact_only_count integer",
      "missing_email_count integer",
      "duplicate_external_id_count integer",
      "duplicate_recipient_count integer",
      "null_associate_count integer",
      "error_code text",
      "safe_error_summary text",
    ]) {
      expect(runsSql).toContain(column);
    }
  });

  it("locks the table to service_role with RLS enabled", () => {
    expect(runsSql).toContain("alter table public.client_sync_runs enable row level security");
    expect(runsSql).toContain("revoke all on public.client_sync_runs from public, anon, authenticated");
    expect(runsSql).toContain("grant select, insert, update on public.client_sync_runs to service_role");
  });

  it("adds lock ownership to cron_locks additively with a legacy-safe default", () => {
    expect(lockSql).toContain(
      "add column owner_token text not null default gen_random_uuid()::text",
    );
    // Additive only: legacy acquirers that omit owner_token keep working via
    // the default, and existing held locks are backfilled by it.
    const lowered = lockSql.toLowerCase();
    expect(lowered).not.toContain("drop");
    expect(lowered).not.toContain("delete from");
    expect(lowered).not.toContain("truncate");
  });

  it("has no columns capable of persisting credentials or raw payloads", () => {
    // Strip SQL comments so this checks actual DDL, not the safety note above it.
    const ddlOnly = runsSql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .toLowerCase();
    for (const forbidden of ["password", "authorization", "token", "payload", "jsonb", " json"]) {
      expect(ddlOnly).not.toContain(forbidden);
    }
  });
});
