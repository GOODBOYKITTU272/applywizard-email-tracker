import { describe, expect, it } from "vitest";
import { extractOriginalRecipient, RecipientExtractionInput } from "./extractRecipient";

const tracker = "tracker@applywizard.ai";

function make(overrides: Partial<RecipientExtractionInput> = {}): RecipientExtractionInput {
  return {
    rawHeaders: "",
    toAddress: "",
    ccAddress: "",
    fromAddress: "external@gmail.com",
    trackerMailbox: tracker,
    ...overrides,
  };
}

describe("extractOriginalRecipient", () => {
  it("1. Delivered-To has one valid client mailbox", () => {
    const r = extractOriginalRecipient(
      make({ rawHeaders: "Delivered-To: alice@applywizard.ai\r\nSubject: Test" }),
    );
    expect(r.routingStatus).toBe("routed");
    expect(r.originalRecipient).toBe("alice@applywizard.ai");
    expect(r.direction).toBe("incoming");
    expect(r.routingConfidence).toBe("single");
  });

  it("2. X-Original-To has one valid client mailbox", () => {
    const r = extractOriginalRecipient(
      make({ rawHeaders: "X-Original-To: bob@applywizard.ai\r\nSubject: Test" }),
    );
    expect(r.routingStatus).toBe("routed");
    expect(r.originalRecipient).toBe("bob@applywizard.ai");
    expect(r.routingConfidence).toBe("single");
  });

  it("3. Tracker in To, original in X-Original-To", () => {
    const r = extractOriginalRecipient(
      make({
        rawHeaders: `X-Original-To: carol@applywizard.ai\r\nSubject: x`,
        toAddress: tracker,
      }),
    );
    expect(r.routingStatus).toBe("routed");
    expect(r.originalRecipient).toBe("carol@applywizard.ai");
  });

  it("4. Multiple valid client candidates → multi_candidate, first used", () => {
    const r = extractOriginalRecipient(
      make({
        rawHeaders:
          "Delivered-To: alice@applywizard.ai\r\nX-Original-To: dave@applywizard.ai",
      }),
    );
    expect(r.routingConfidence).toBe("multi_candidate");
    expect(r.originalRecipient).toBe("alice@applywizard.ai");
    expect(r.routingStatus).toBe("routed");
  });

  it("5. No valid client recipient → unroutable", () => {
    const r = extractOriginalRecipient(
      make({
        rawHeaders: "Delivered-To: tracker@applywizard.ai",
        toAddress: tracker,
      }),
    );
    expect(r.routingStatus).toBe("unroutable");
    expect(r.originalRecipient).toBeNull();
  });

  it("6. Internal email (all @applywizard.ai addresses) → internal", () => {
    const r = extractOriginalRecipient(
      make({
        fromAddress: "alice@applywizard.ai",
        toAddress: "bob@applywizard.ai",
        ccAddress: "",
      }),
    );
    expect(r.routingStatus).toBe("internal");
    expect(r.originalRecipient).toBeNull();
  });

  it("7. Outgoing: client sender with external recipient → outgoing direction", () => {
    const r = extractOriginalRecipient(
      make({
        fromAddress: "alice@applywizard.ai",
        toAddress: "recruiter@bigcorp.com",
      }),
    );
    expect(r.direction).toBe("outgoing");
    expect(r.originalRecipient).toBe("alice@applywizard.ai");
    expect(r.routingStatus).toBe("routed");
  });

  it("8. Mixed-case email addresses → normalized to lowercase", () => {
    const r = extractOriginalRecipient(
      make({ rawHeaders: "Delivered-To: ALICE@APPLYWIZARD.AI" }),
    );
    expect(r.originalRecipient).toBe("alice@applywizard.ai");
  });

  it("9. Malformed header values → graceful fallback or unroutable, no throw", () => {
    expect(() =>
      extractOriginalRecipient(
        make({ rawHeaders: "Delivered-To: not-an-email\r\nBroken Header\r\n:" }),
      ),
    ).not.toThrow();
    const r = extractOriginalRecipient(
      make({ rawHeaders: "Delivered-To: not-an-email\r\nBroken Header\r\n:" }),
    );
    expect(["routed", "unroutable", "internal"]).toContain(r.routingStatus);
  });

  it("10. No raw header content in extraction result", () => {
    const r = extractOriginalRecipient(
      make({ rawHeaders: "Delivered-To: alice@applywizard.ai\r\nX-Secret: secret-value" }),
    );
    const resultStr = JSON.stringify(r);
    expect(resultStr).not.toContain("X-Secret");
    expect(resultStr).not.toContain("secret-value");
    expect(resultStr).not.toContain("Delivered-To");
  });
});
