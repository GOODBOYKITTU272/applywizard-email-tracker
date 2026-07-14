import { describe, expect, it, vi } from "vitest";

import { mapRecipientToClient, type ClientLookupSupabase } from "./mapRecipientToClient";

// Fake Supabase clients lookup that records the applied filters and returns a
// configurable row/error. Enforces the two-eq shape used by the real query.
function fakeSupabase(result: { row?: { id: string } | null; error?: boolean } = {}) {
  const filters: Array<{ column: string; value: string | boolean }> = [];
  const client: ClientLookupSupabase = {
    from: vi.fn((table: string) => {
      expect(table).toBe("clients");
      return {
        select: (columns: string) => {
          expect(columns).toBe("id");
          const chain = {
            eq: (column: string, value: string | boolean) => {
              filters.push({ column, value });
              return chain;
            },
            maybeSingle: async () =>
              result.error
                ? { data: null, error: { message: "boom" } }
                : { data: result.row ?? null, error: null },
          };
          return chain as never;
        },
      };
    }),
  };
  return { client, filters };
}

describe("mapRecipientToClient (DB-backed)", () => {
  it("internal routing → internal, no client id, no DB call", async () => {
    const { client, filters } = fakeSupabase();
    const r = await mapRecipientToClient(client, "alice@applywizard.ai", "internal");
    expect(r).toEqual({ status: "internal", normalizedRecipient: "alice@applywizard.ai", clientId: null });
    expect(filters).toHaveLength(0);
  });

  it("null/empty recipient → unmatched with null normalized recipient", async () => {
    const { client } = fakeSupabase();
    expect(await mapRecipientToClient(client, null, "routed")).toEqual({
      status: "unmatched",
      normalizedRecipient: null,
      clientId: null,
    });
    expect(await mapRecipientToClient(client, "   ", "routed")).toEqual({
      status: "unmatched",
      normalizedRecipient: null,
      clientId: null,
    });
  });

  it("admin mailbox → admin, no client id, no DB call", async () => {
    const { client, filters } = fakeSupabase({ row: { id: "should-not-be-used" } });
    const r = await mapRecipientToClient(client, "Ramakrishna@ApplyWizard.ai", "routed");
    expect(r).toEqual({ status: "admin", normalizedRecipient: "ramakrishna@applywizard.ai", clientId: null });
    expect(filters).toHaveLength(0);
  });

  it("matched active client → matched with normalized recipient and client id", async () => {
    const { client, filters } = fakeSupabase({ row: { id: "client-123" } });
    const r = await mapRecipientToClient(client, "  Preview-Test-Client@ApplyWizard.ai ", "routed");
    expect(r).toEqual({
      status: "matched",
      normalizedRecipient: "preview-test-client@applywizard.ai",
      clientId: "client-123",
    });
    // Queried by normalized recipient AND is_active = true only.
    expect(filters).toEqual([
      { column: "recipient_email_normalized", value: "preview-test-client@applywizard.ai" },
      { column: "is_active", value: true },
    ]);
  });

  it("unknown recipient (no active client) → unmatched", async () => {
    const { client } = fakeSupabase({ row: null });
    expect(await mapRecipientToClient(client, "nobody@applywizard.ai", "routed")).toEqual({
      status: "unmatched",
      normalizedRecipient: "nobody@applywizard.ai",
      clientId: null,
    });
  });

  it("DB error → unmatched, never throws (mapping cannot block classification)", async () => {
    const { client } = fakeSupabase({ error: true });
    await expect(mapRecipientToClient(client, "x@applywizard.ai", "routed")).resolves.toEqual({
      status: "unmatched",
      normalizedRecipient: "x@applywizard.ai",
      clientId: null,
    });
  });
});
