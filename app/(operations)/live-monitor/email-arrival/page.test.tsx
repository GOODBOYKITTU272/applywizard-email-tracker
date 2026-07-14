import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dashboardAuth/requireDashboardSession", () => ({
  requireDashboardSession: vi.fn().mockResolvedValue({
    id: "session-1",
    userId: "user-1",
    expiresAt: "2099-01-01T00:00:00.000Z",
    revokedAt: null,
    user: {
      id: "user-1",
      email: "admin@applywizz.ai",
      role: "admin_ceo",
      status: "active",
      totpEnabled: true,
    },
  }),
}));
vi.mock("@/lib/zoho/emailArrival", () => ({
  formatIstTime: (value: string | null) => value ?? "Not available yet",
  getEmailArrivalMonitorData: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      rows: [
        {
          originalRecipient: "a@example.test",
          clientName: "Client A",
          assignedCaName: "CA A",
          assignedCaEmail: "ca-a@example.test",
          emailsToday: 2,
          latestEmailAt: "2026-07-09T10:00:00.000Z",
        },
      ],
      totalEmailsToday: 2,
      latestEmailAt: "2026-07-09T10:00:00.000Z",
      activeMailboxesToday: 1,
    },
  }),
}));

describe("EmailArrivalMonitorPage", () => {
  it("renders a refresh meta tag in the page markup", async () => {
    const { default: EmailArrivalMonitorPage } = await import("./page");
    const markup = renderToStaticMarkup(await EmailArrivalMonitorPage());

    expect(markup).toContain('http-equiv="refresh"');
    expect(markup).toContain('content="20"');
  });

  it("renders client and assigned CA columns", async () => {
    const { default: EmailArrivalMonitorPage } = await import("./page");
    const markup = renderToStaticMarkup(await EmailArrivalMonitorPage());

    expect(markup).toContain("Client Name");
    expect(markup).toContain("Assigned CA");
    expect(markup).toContain("CA Email");
    expect(markup).toContain("Client A");
    expect(markup).toContain("CA A");
    expect(markup).toContain("ca-a@example.test");
  });
});
