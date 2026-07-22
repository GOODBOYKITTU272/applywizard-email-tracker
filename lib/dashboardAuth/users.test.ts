import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type DashboardUserRow = {
  id: string;
  email: string;
  role: "admin_ceo" | "manager_ops" | "ca";
  status: "active" | "disabled";
  totp_enabled: boolean;
  totp_secret_encrypted: string | null;
};

type SelectResult = { data: Record<string, unknown> | null; error: { message: string } | null };
type UpdateResult = { data: { id: string } | null; error: { message: string } | null };

const activeUser: DashboardUserRow = {
  id: "user-1",
  email: "Admin@applywizz.ai",
  role: "admin_ceo",
  status: "active",
  totp_enabled: false,
  totp_secret_encrypted: null,
};

const disabledUser: DashboardUserRow = {
  id: "user-2",
  email: "ca@applywizz.ai",
  role: "ca",
  status: "disabled",
  totp_enabled: false,
  totp_secret_encrypted: null,
};

let users: DashboardUserRow[];
let selectResult: SelectResult;
let updateResult: UpdateResult;

interface CallRecord {
  kind: "select" | "select.eq" | "update" | "update.eq" | "update.select" | "insert" | "insert.select";
  table: string;
  columns?: string;
  payload?: Record<string, unknown>;
  column?: string;
  value?: string;
}

let calls: CallRecord[];
let forceNextInsertConflict = false;

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: (table: string) => ({
      select: (columns: string) => {
        calls.push({ kind: "select", table, columns });
        const chain = {
          eq: (column: string, value: string) => {
            calls.push({ kind: "select.eq", table, column, value });
            return {
              maybeSingle: async () => selectResultFor(table, columns, column, value),
            };
          },
        };
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        calls.push({ kind: "update", table, payload });
        const chain = {
          eq: (column: string, value: string) => {
            calls.push({ kind: "update.eq", table, column, value });
            return {
              select: (columns: string) => {
                calls.push({ kind: "update.select", table, columns });
                return {
                  maybeSingle: async () => {
                    applyUpdate(table, payload, column, value);
                    return updateResult;
                  },
                };
              },
            };
          },
        };
        return chain;
      },
      insert: (payload: Record<string, unknown>) => {
        calls.push({ kind: "insert", table, payload });
        return {
          select: (columns: string) => {
            calls.push({ kind: "insert.select", table, columns });
            return {
              maybeSingle: async () => {
                if (table === "dashboard_users" && forceNextInsertConflict) {
                  forceNextInsertConflict = false;
                  // The conflicting row only becomes visible now — simulating a
                  // concurrent process committing its insert at the moment ours
                  // collides, not before. If it were visible earlier, the initial
                  // select (before this insert attempt) would short-circuit and
                  // the conflict path would never actually be exercised.
                  if (pendingRaceRow) {
                    users.push(pendingRaceRow);
                    pendingRaceRow = null;
                  }
                  return { data: null, error: { code: "23505", message: "duplicate key" } };
                }
                return applyInsert(table, payload);
              },
            };
          },
        };
      },
    }),
  }),
}));

let pendingRaceRow: DashboardUserRow | null = null;

function noInsertOccurred(): boolean {
  return !calls.some((call) => call.kind === "insert");
}

function forceNextDashboardUserInsertToReturn23505ThenExposeRow(row: DashboardUserRow): void {
  forceNextInsertConflict = true;
  pendingRaceRow = row;
}

function applyInsert(
  table: string,
  payload: Record<string, unknown>,
): { data: DashboardUserRow | null; error: { code?: string; message: string } | null } {
  if (table !== "dashboard_users") return { data: null, error: null };

  const newUser: DashboardUserRow = {
    id: `user-${users.length + 1}`,
    email: String(payload.email ?? ""),
    role: payload.role as DashboardUserRow["role"],
    status: (payload.status as DashboardUserRow["status"]) ?? "active",
    totp_enabled: false,
    totp_secret_encrypted: null,
  };
  users.push(newUser);
  return { data: newUser, error: null };
}

function findUserByColumn(column: "email_normalized" | "id", value: string): DashboardUserRow | null {
  return users.find((user) => {
    if (column === "id") return user.id === value;
    return user.email.trim().toLowerCase() === value;
  }) ?? null;
}

function selectResultFor(table: string, columns: string, column: string, value: string): SelectResult {
  if (table !== "dashboard_users") return selectResult;
  const user = findUserByColumn(column as "email_normalized" | "id", value);
  if (selectResult.error) return selectResult;
  if (!user) return { data: null, error: null };

  if (columns.includes("totp_secret_encrypted")) {
    return {
      data: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        totp_enabled: user.totp_enabled,
        totp_secret_encrypted: user.totp_secret_encrypted,
      },
      error: null,
    };
  }

  return {
    data: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      totp_enabled: user.totp_enabled,
    },
    error: null,
  };
}

function applyUpdate(
  table: string,
  payload: Record<string, unknown>,
  column: string,
  value: string,
): void {
  if (table !== "dashboard_users" || updateResult.error) return;
  const user = findUserByColumn(column as "email_normalized" | "id", value);
  if (!user) {
    updateResult = { data: null, error: null };
    return;
  }

  Object.assign(user, payload);
  updateResult = { data: { id: user.id }, error: null };
}

beforeEach(() => {
  vi.resetModules();
  calls = [];
  forceNextInsertConflict = false;
  pendingRaceRow = null;
  selectResult = { data: null, error: null };
  updateResult = { data: { id: activeUser.id }, error: null };
  users = [
    { ...activeUser, totp_secret_encrypted: null },
    { ...disabledUser, totp_secret_encrypted: null },
  ];
});

describe("getDashboardUserByEmail", () => {
  it("returns an active dashboard user by normalized email", async () => {
    const { getDashboardUserByEmail } = await import("./users");

    await expect(getDashboardUserByEmail("  ADMIN@ApplyWizz.AI ")).resolves.toEqual({
      id: "user-1",
      email: "Admin@applywizz.ai",
      role: "admin_ceo",
      status: "active",
      totpEnabled: false,
    });
    expect(calls).toContainEqual({
      kind: "select",
      table: "dashboard_users",
      columns: "id, email, role, status, totp_enabled",
    });
    expect(calls).toContainEqual({
      kind: "select.eq",
      table: "dashboard_users",
      column: "email_normalized",
      value: "admin@applywizz.ai",
    });
  });

  it("returns a disabled dashboard user", async () => {
    const { getDashboardUserByEmail } = await import("./users");

    await expect(getDashboardUserByEmail("ca@applywizz.ai")).resolves.toEqual({
      id: "user-2",
      email: "ca@applywizz.ai",
      role: "ca",
      status: "disabled",
      totpEnabled: false,
    });
  });

  it("returns null when the user is not found", async () => {
    const { getDashboardUserByEmail } = await import("./users");

    await expect(getDashboardUserByEmail("missing@applywizz.ai")).resolves.toBeNull();
  });

  it("returns null on query errors", async () => {
    selectResult = { data: null, error: { message: "database unavailable" } };
    const { getDashboardUserByEmail } = await import("./users");

    await expect(getDashboardUserByEmail("admin@applywizz.ai")).resolves.toBeNull();
  });
});

describe("getDashboardUserById", () => {
  it("returns a dashboard user by id without exposing the TOTP secret", async () => {
    const { getDashboardUserById } = await import("./users");

    await expect(getDashboardUserById("user-1")).resolves.toEqual({
      id: "user-1",
      email: "Admin@applywizz.ai",
      role: "admin_ceo",
      status: "active",
      totpEnabled: false,
    });
    expect(JSON.stringify(calls)).not.toContain("totp_secret_encrypted");
  });

  it("returns null on query errors", async () => {
    selectResult = { data: null, error: { message: "database unavailable" } };
    const { getDashboardUserById } = await import("./users");

    await expect(getDashboardUserById("user-1")).resolves.toBeNull();
  });
});

describe("getDashboardUserAuthRecordById", () => {
  it("returns the TOTP secret alongside the public user fields", async () => {
    users[0].totp_secret_encrypted = "totp-secret-encrypted";
    users[0].totp_enabled = true;
    const { getDashboardUserAuthRecordById } = await import("./users");

    await expect(getDashboardUserAuthRecordById("user-1")).resolves.toEqual({
      id: "user-1",
      email: "Admin@applywizz.ai",
      role: "admin_ceo",
      status: "active",
      totpEnabled: true,
      totpSecretEncrypted: "totp-secret-encrypted",
    });
    expect(calls).toContainEqual({
      kind: "select",
      table: "dashboard_users",
      columns: "id, email, role, status, totp_enabled, totp_secret_encrypted",
    });
  });

  it("returns null on query errors", async () => {
    selectResult = { data: null, error: { message: "database unavailable" } };
    const { getDashboardUserAuthRecordById } = await import("./users");

    await expect(getDashboardUserAuthRecordById("user-1")).resolves.toBeNull();
  });
});

describe("setDashboardUserTotpSecret", () => {
  it("stores the encrypted secret and enables TOTP", async () => {
    const { setDashboardUserTotpSecret } = await import("./users");

    await expect(
      setDashboardUserTotpSecret({ userId: "user-1", encryptedSecret: "totp-secret-encrypted" }),
    ).resolves.toEqual({ ok: true });
    expect(users[0]).toMatchObject({
      totp_enabled: true,
      totp_secret_encrypted: "totp-secret-encrypted",
    });
    expect(calls).toContainEqual({
      kind: "update",
      table: "dashboard_users",
      payload: {
        totp_secret_encrypted: "totp-secret-encrypted",
        totp_enabled: true,
      },
    });
    expect(calls).toContainEqual({
      kind: "update.select",
      table: "dashboard_users",
      columns: "id",
    });
  });

  it("returns ok:false when the user is missing", async () => {
    const { setDashboardUserTotpSecret } = await import("./users");

    await expect(
      setDashboardUserTotpSecret({ userId: "missing", encryptedSecret: "totp-secret-encrypted" }),
    ).resolves.toEqual({ ok: false });
  });
});

describe("getOrCreateDashboardUserForLogin", () => {
  it("creates a new active ca user for a valid applywizz email", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");
    await expect(getOrCreateDashboardUserForLogin("New.User@ApplyWizz.AI")).resolves.toMatchObject({
      created: true,
      user: {
        email: "new.user@applywizz.ai",
        role: "ca",
        status: "active",
        totpEnabled: false,
      },
    });
  });

  it("returns existing users unchanged and created=false", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");
    await expect(getOrCreateDashboardUserForLogin("admin@applywizz.ai")).resolves.toMatchObject({
      created: false,
      user: { id: "user-1", role: "admin_ceo", status: "active" },
    });
    expect(noInsertOccurred()).toBe(true);
  });

  it("returns disabled users unchanged so authFlow can block them", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");
    await expect(getOrCreateDashboardUserForLogin("ca@applywizz.ai")).resolves.toMatchObject({
      created: false,
      user: { status: "disabled" },
    });
  });

  it("returns null and inserts nothing for blocked domains", async () => {
    const { getOrCreateDashboardUserForLogin } = await import("./users");
    await expect(getOrCreateDashboardUserForLogin("user@applywizard.ai")).resolves.toBeNull();
    expect(noInsertOccurred()).toBe(true);
  });

  it("recovers from PostgreSQL 23505 by re-reading the winning row", async () => {
    forceNextDashboardUserInsertToReturn23505ThenExposeRow({
      id: "race-user",
      email: "race@applywizz.ai",
      role: "ca",
      status: "active",
      totp_enabled: false,
      totp_secret_encrypted: null,
    });

    const { getOrCreateDashboardUserForLogin } = await import("./users");
    await expect(getOrCreateDashboardUserForLogin("race@applywizz.ai")).resolves.toMatchObject({
      created: false,
      user: { id: "race-user", email: "race@applywizz.ai" },
    });
  });
});
