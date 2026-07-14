import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  disablePreviewAdmin,
  revokePreviewAdminSessionsForUser,
  sanitizeProjectRef,
  seedPreviewAdmin,
  type PreviewAdminSupabase,
} from "../../scripts/dashboard-auth/previewAdminTool";
import { runSeedPreviewAdminCli } from "../../scripts/dashboard-auth/seed-preview-admin";

type Row = Record<string, unknown>;

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DASHBOARD_AUTH_SEED_TARGET: "preview",
    DASHBOARD_TEST_ADMIN_EMAIL: " Dashboard-Auth-Test@ApplyWizz.AI ",
    DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF: "zyxwvutsrqponmlkjihg",
    ...overrides,
  };
}

function makeLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      info: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    },
  };
}

function makeSupabase(
  initialRows: Row[] = [],
  options: { failUpdate?: boolean; failSessionUpdate?: boolean; failInsert?: boolean } = {},
) {
  const users = [...initialRows];
  const sessionUpdates: Array<{ table: string; payload: Row; filters: Array<[string, unknown]> }> = [];

  const client: PreviewAdminSupabase = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(column: string, value: string) {
              return {
                async maybeSingle() {
                  expect(columns).not.toBe("*");
                  const row = users.find((item) => item[column] === value) ?? null;
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        insert(row: Row) {
          expect(table).toBe("dashboard_users");
          return {
            select(columns: string) {
              return {
                async single() {
                  expect(columns).not.toBe("*");
                  if (options.failInsert) return { data: null, error: { message: "insert failed" } };
                  const inserted = {
                    id: `user-${users.length + 1}`,
                    email_normalized: String(row.email).toLowerCase(),
                    ...row,
                  };
                  users.push(inserted);
                  return { data: { id: inserted.id }, error: null };
                },
              };
            },
          };
        },
        update(payload: Row) {
          const filters: Array<[string, unknown]> = [];
          return {
            eq(column: string, value: string) {
              filters.push([column, value]);
              return {
                is(isColumn: string, isValue: null) {
                  filters.push([isColumn, isValue]);
                  const shouldFail = table === "dashboard_sessions" ? options.failSessionUpdate : options.failUpdate;
                  return Promise.resolve({ error: shouldFail ? { message: "update failed" } : null });
                },
                select(columns: string) {
                  return {
                    async maybeSingle() {
                      expect(table).toBe("dashboard_users");
                      expect(columns).not.toBe("*");
                      if (options.failUpdate) return { data: null, error: { message: "update failed" } };
                      const index = users.findIndex((item) => item[column] === value);
                      if (index < 0) return { data: null, error: null };
                      users[index] = { ...users[index], ...payload };
                      return { data: { id: users[index].id }, error: null };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return { client, users, sessionUpdates };
}

describe("preview dashboard admin seed tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses without the Preview seed target flag", async () => {
    const supabase = makeSupabase();

    const result = await seedPreviewAdmin({
      env: env({ DASHBOARD_AUTH_SEED_TARGET: "production" }),
      supabase: supabase.client,
    });

    expect(result).toEqual({ ok: false, code: "INVALID_TARGET" });
    expect(supabase.users).toHaveLength(0);
  });

  it("refuses a mismatched Supabase project reference", async () => {
    const result = await seedPreviewAdmin({
      env: env({ NEXT_PUBLIC_SUPABASE_URL: "https://aaaaaaaaaaaaaaaaaaaa.supabase.co" }),
      supabase: makeSupabase().client,
    });

    expect(result).toEqual({ ok: false, code: "PROJECT_REF_MISMATCH" });
  });

  it("refuses the production Supabase project reference", async () => {
    const result = await seedPreviewAdmin({
      env: env({
        DASHBOARD_PREVIEW_SUPABASE_PROJECT_REF: "zyxwvutsrqponmlkjihg",
        NEXT_PUBLIC_SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co",
        DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF: "zyxwvutsrqponmlkjihg",
      }),
      supabase: makeSupabase().client,
    });

    expect(result).toEqual({ ok: false, code: "PRODUCTION_PROJECT_REF" });
  });

  it("requires an explicit production project reference", async () => {
    const result = await seedPreviewAdmin({
      env: env({ DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF: "" }),
      supabase: makeSupabase().client,
    });

    expect(result).toEqual({ ok: false, code: "MISSING_PRODUCTION_PROJECT_REF" });
  });

  it("rejects malformed production project reference", async () => {
    const result = await seedPreviewAdmin({
      env: env({ DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF: "not-a-project-ref" }),
      supabase: makeSupabase().client,
    });

    expect(result).toEqual({ ok: false, code: "MALFORMED_PRODUCTION_PROJECT_REF" });
  });

  it("rejects equal Preview and production project references", async () => {
    const result = await seedPreviewAdmin({
      env: env({ DASHBOARD_PRODUCTION_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst" }),
      supabase: makeSupabase().client,
    });

    expect(result).toEqual({ ok: false, code: "PRODUCTION_PROJECT_REF" });
  });

  it("rejects mixed values that point the URL at production", async () => {
    const result = await seedPreviewAdmin({
      env: env({ NEXT_PUBLIC_SUPABASE_URL: "https://zyxwvutsrqponmlkjihg.supabase.co" }),
      supabase: makeSupabase().client,
    });

    expect(result).toEqual({ ok: false, code: "PRODUCTION_PROJECT_REF" });
  });

  it("refuses missing email", async () => {
    const result = await seedPreviewAdmin({
      env: env({ DASHBOARD_TEST_ADMIN_EMAIL: " " }),
      supabase: makeSupabase().client,
    });

    expect(result).toEqual({ ok: false, code: "MISSING_EMAIL" });
  });

  it("normalizes email and creates the expected active admin_ceo row", async () => {
    const supabase = makeSupabase();
    const { logger, lines } = makeLogger();

    const result = await seedPreviewAdmin({ env: env(), supabase: supabase.client, logger });

    expect(result).toMatchObject({
      ok: true,
      mode: "seed",
      action: "created",
      normalizedEmail: "dashboard-auth-test@applywizz.ai",
      projectRef: "abcdefghijklmnopqrst",
    });
    expect(supabase.users).toEqual([
      expect.objectContaining({
        email: "dashboard-auth-test@applywizz.ai",
        role: "admin_ceo",
        status: "active",
        totp_enabled: false,
        totp_secret_encrypted: null,
      }),
    ]);
    expect(lines.join("\n")).toContain("dashboard-auth-test@applywizz.ai");
    expect(lines.join("\n")).toContain(sanitizeProjectRef("abcdefghijklmnopqrst"));
  });

  it("resets TOTP fields and is idempotent for an existing user", async () => {
    const supabase = makeSupabase([
      {
        id: "user-1",
        email: "dashboard-auth-test@applywizz.ai",
        email_normalized: "dashboard-auth-test@applywizz.ai",
        role: "ca",
        status: "disabled",
        totp_enabled: true,
        totp_secret_encrypted: "encrypted-secret",
      },
    ]);

    const first = await seedPreviewAdmin({ env: env(), supabase: supabase.client });
    const second = await seedPreviewAdmin({ env: env(), supabase: supabase.client });

    expect(first).toMatchObject({ ok: true, action: "updated" });
    expect(second).toMatchObject({ ok: true, action: "updated" });
    expect(supabase.users).toHaveLength(1);
    expect(supabase.users[0]).toMatchObject({
      role: "admin_ceo",
      status: "active",
      totp_enabled: false,
      totp_secret_encrypted: null,
    });
  });

  it("does not log secrets", async () => {
    const supabase = makeSupabase();
    const { logger, lines } = makeLogger();

    await seedPreviewAdmin({ env: env(), supabase: supabase.client, logger });

    expect(lines.join("\n")).not.toContain("service-role-secret");
    expect(lines.join("\n")).not.toContain("encrypted-secret");
    expect(lines.join("\n")).not.toContain("session-token");
  });

  it("dry-run seed performs no writes", async () => {
    const supabase = makeSupabase();

    const result = await seedPreviewAdmin({ env: env(), supabase: supabase.client, dryRun: true });

    expect(result).toMatchObject({ ok: true, action: "would_create" });
    expect(supabase.users).toHaveLength(0);
  });
});

describe("preview dashboard admin disable mode", () => {
  it("disables an active user and revokes all sessions", async () => {
    const supabase = makeSupabase([
      {
        id: "user-1",
        email: "dashboard-auth-test@applywizz.ai",
        email_normalized: "dashboard-auth-test@applywizz.ai",
        role: "admin_ceo",
        status: "active",
        totp_enabled: true,
      },
    ]);
    const revokeAllSessionsForUser = vi.fn().mockResolvedValue({ ok: true });

    const result = await disablePreviewAdmin({ env: env(), supabase: supabase.client, revokeAllSessionsForUser });

    expect(result).toMatchObject({ ok: true, mode: "disable", action: "disabled" });
    expect(supabase.users[0]).toMatchObject({ status: "disabled" });
    expect(revokeAllSessionsForUser).toHaveBeenCalledWith("user-1");
  });

  it("is idempotent for disabled or missing users", async () => {
    const disabledSupabase = makeSupabase([
      {
        id: "user-1",
        email: "dashboard-auth-test@applywizz.ai",
        email_normalized: "dashboard-auth-test@applywizz.ai",
        role: "admin_ceo",
        status: "disabled",
      },
    ]);
    const revokeAllSessionsForUser = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      disablePreviewAdmin({ env: env(), supabase: disabledSupabase.client, revokeAllSessionsForUser }),
    ).resolves.toMatchObject({ ok: true, action: "already_disabled" });
    await expect(
      disablePreviewAdmin({ env: env(), supabase: makeSupabase().client, revokeAllSessionsForUser }),
    ).resolves.toMatchObject({ ok: true, action: "missing" });
  });

  it("returns failure on cleanup errors", async () => {
    const supabase = makeSupabase([
      {
        id: "user-1",
        email: "dashboard-auth-test@applywizz.ai",
        email_normalized: "dashboard-auth-test@applywizz.ai",
        role: "admin_ceo",
        status: "active",
      },
    ]);

    await expect(
      disablePreviewAdmin({
        env: env(),
        supabase: supabase.client,
        revokeAllSessionsForUser: vi.fn().mockResolvedValue({ ok: false }),
      }),
    ).resolves.toEqual({ ok: false, code: "REVOKE_FAILED" });
  });

  it("does not log secrets", async () => {
    const supabase = makeSupabase([
      {
        id: "user-1",
        email: "dashboard-auth-test@applywizz.ai",
        email_normalized: "dashboard-auth-test@applywizz.ai",
        role: "admin_ceo",
        status: "active",
      },
    ]);
    const { logger, lines } = makeLogger();

    await disablePreviewAdmin({
      env: env(),
      supabase: supabase.client,
      revokeAllSessionsForUser: vi.fn().mockResolvedValue({ ok: true }),
      logger,
    });

    expect(lines.join("\n")).not.toContain("service-role-secret");
    expect(lines.join("\n")).not.toContain("session-token");
  });

  it("revoke-all updates only active sessions for the exact user", async () => {
    const calls: Array<{ table: string; payload: Row; eq: [string, string] | null; is: [string, null] | null }> = [];
    const supabase: PreviewAdminSupabase = {
      from(table: string) {
        return {
          select: () => {
            throw new Error("select not expected");
          },
          insert: () => {
            throw new Error("insert not expected");
          },
          update(payload: Row) {
            const call = { table, payload, eq: null as [string, string] | null, is: null as [string, null] | null };
            calls.push(call);
            return {
              eq(column: string, value: string) {
                call.eq = [column, value];
                return {
                  is(isColumn: string, isValue: null) {
                    call.is = [isColumn, isValue];
                    return Promise.resolve({ error: null });
                  },
                  select: () => {
                    throw new Error("select not expected");
                  },
                };
              },
            };
          },
        };
      },
    };

    await expect(revokePreviewAdminSessionsForUser(supabase, "user-1")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      {
        table: "dashboard_sessions",
        payload: { revoked_at: expect.any(String) },
        eq: ["user_id", "user-1"],
        is: ["revoked_at", null],
      },
    ]);
  });

  it("revoke failure returns cleanup failure", async () => {
    const supabase = makeSupabase(
      [
        {
          id: "user-1",
          email: "dashboard-auth-test@applywizz.ai",
          email_normalized: "dashboard-auth-test@applywizz.ai",
          role: "admin_ceo",
          status: "active",
        },
      ],
      { failSessionUpdate: true },
    );

    await expect(
      disablePreviewAdmin({
        env: env(),
        supabase: supabase.client,
        revokeAllSessionsForUser: (userId) => revokePreviewAdminSessionsForUser(supabase.client, userId),
      }),
    ).resolves.toEqual({ ok: false, code: "REVOKE_FAILED" });
  });
});

describe("preview dashboard admin CLI", () => {
  it.each(["--dryrun", "--disable-user", "--force", "--production"])(
    "rejects unknown flag %s before validation or client creation",
    async (unknownFlag) => {
      const createSupabase = vi.fn();
      const { logger, lines } = makeLogger();

      const result = await runSeedPreviewAdminCli({
        args: [unknownFlag],
        env: env({ DASHBOARD_AUTH_SEED_TARGET: "" }),
        createSupabase,
        logger,
      });

      expect(result).toEqual({ ok: false, code: "UNKNOWN_FLAG" });
      expect(createSupabase).not.toHaveBeenCalled();
      expect(lines.join("\n")).toContain("failed code=UNKNOWN_FLAG");
      expect(lines.join("\n")).not.toContain("service-role-secret");
    },
  );

  it("rejects --disable --dry-run before creating a client", async () => {
    const createSupabase = vi.fn();
    const { logger, lines } = makeLogger();

    const result = await runSeedPreviewAdminCli({
      args: ["--disable", "--dry-run"],
      env: env(),
      createSupabase,
      logger,
    });

    expect(result).toEqual({ ok: false, code: "CONFLICTING_FLAGS" });
    expect(createSupabase).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("failed code=CONFLICTING_FLAGS");
  });

  it("validation failure does not create a Supabase client", async () => {
    const createSupabase = vi.fn();

    const result = await runSeedPreviewAdminCli({
      args: [],
      env: env({ DASHBOARD_AUTH_SEED_TARGET: "" }),
      createSupabase,
    });

    expect(result).toEqual({ ok: false, code: "INVALID_TARGET" });
    expect(createSupabase).not.toHaveBeenCalled();
  });

  it("valid --dry-run still reaches seed mode", async () => {
    const supabase = makeSupabase();
    const createSupabase = vi.fn(() => supabase.client);

    const result = await runSeedPreviewAdminCli({
      args: ["--dry-run"],
      env: env(),
      createSupabase,
    });

    expect(result).toMatchObject({ ok: true, mode: "seed", action: "would_create" });
    expect(createSupabase).toHaveBeenCalledTimes(1);
    expect(supabase.users).toHaveLength(0);
  });

  it("valid --disable still reaches disable mode", async () => {
    const supabase = makeSupabase([
      {
        id: "user-1",
        email: "dashboard-auth-test@applywizz.ai",
        email_normalized: "dashboard-auth-test@applywizz.ai",
        role: "admin_ceo",
        status: "active",
      },
    ]);
    const createSupabase = vi.fn(() => supabase.client);

    const result = await runSeedPreviewAdminCli({
      args: ["--disable"],
      env: env(),
      createSupabase,
    });

    expect(result).toMatchObject({ ok: true, mode: "disable", action: "disabled" });
    expect(createSupabase).toHaveBeenCalledTimes(1);
    expect(supabase.users[0]).toMatchObject({ status: "disabled" });
  });

  it("no-flag seed mode remains supported", async () => {
    const supabase = makeSupabase();
    const createSupabase = vi.fn(() => supabase.client);

    const result = await runSeedPreviewAdminCli({
      args: [],
      env: env(),
      createSupabase,
    });

    expect(result).toMatchObject({ ok: true, mode: "seed", action: "created" });
    expect(createSupabase).toHaveBeenCalledTimes(1);
    expect(supabase.users).toHaveLength(1);
  });

  it("importing the CLI exposes validation without resolving server-only", async () => {
    expect(typeof runSeedPreviewAdminCli).toBe("function");
  });
});
