import { describe, expect, it } from "vitest";
import { mockClients } from "@/lib/mockData";
import { mapRecipientToClient } from "./mapRecipientToClient";

describe("mapRecipientToClient", () => {
  it("internal routing → internal status, no client id", () => {
    const r = mapRecipientToClient("alice@applywizard.ai", "internal");
    expect(r.status).toBe("internal");
    expect(r.clientId).toBeNull();
  });

  it("null recipient → unmatched", () => {
    const r = mapRecipientToClient(null, "routed");
    expect(r.status).toBe("unmatched");
    expect(r.clientId).toBeNull();
  });

  it("admin mailbox → admin status, no client id", () => {
    const r = mapRecipientToClient("ramakrishna@applywizard.ai", "routed");
    expect(r.status).toBe("admin");
    expect(r.clientId).toBeNull();
  });

  it("case-insensitive match against mock client", () => {
    // ponytail: relies on mockClients having at least one non-admin @applywizard.ai entry
    const first = mockClients.find(
      (c) =>
        c.mailbox.endsWith("@applywizard.ai") &&
        c.mailbox.toLowerCase() !== "ramakrishna@applywizard.ai",
    );
    if (!first) return; // skip if mock data has no client mailboxes
    const r = mapRecipientToClient(first.mailbox.toUpperCase(), "routed");
    expect(r.status).toBe("matched");
    expect(r.clientId).toBe(first.id);
  });

  it("unknown @applywizard.ai mailbox → unmatched", () => {
    const r = mapRecipientToClient("nobody@applywizard.ai", "routed");
    expect(r.status).toBe("unmatched");
    expect(r.clientId).toBeNull();
  });
});
