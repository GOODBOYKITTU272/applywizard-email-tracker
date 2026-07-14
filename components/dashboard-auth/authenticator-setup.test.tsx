import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import { AuthenticatorSetup } from "./dashboard-auth-client";

// Generated test-only material. The previously screenshotted secret is treated
// as compromised and deliberately not reused here.
const SECRET = "MZXW6YTBOI======";
const URI =
  "otpauth://totp/ApplyWizz%20Dashboard:setup-test@applywizz.ai?secret=MZXW6YTBOI======&issuer=ApplyWizz%20Dashboard&algorithm=SHA1&digits=6&period=30";

function render(overrides: Partial<Parameters<typeof AuthenticatorSetup>[0]> = {}) {
  return renderToStaticMarkup(
    <AuthenticatorSetup
      provisioningUri={URI}
      totpSecret={SECRET}
      setupCode=""
      busy={false}
      onCodeChange={() => {}}
      onSubmit={(event) => event.preventDefault()}
      onReset={() => {}}
      {...overrides}
    />,
  );
}

describe("AuthenticatorSetup", () => {
  it("renders a QR code derived from the provisioning URI", () => {
    const markup = render();
    expect(markup).toContain("<svg");
    // Different provisioning URIs must produce different QR module output,
    // proving the QR encodes the URI rather than a constant.
    const other = render({ provisioningUri: URI.replace("MZXW6YTBOI======", "NB2W45DFOIZA====") });
    expect(other).not.toEqual(markup);
  });

  it("hides the one-time secret by default", () => {
    const markup = render();
    expect(markup).not.toContain(SECRET);
    expect(markup).toContain("Show setup key");
  });

  it("never renders the raw provisioning URI as text", () => {
    const markup = render();
    expect(markup).not.toContain("otpauth://");
    expect(markup).not.toContain(URI);
    expect(markup).not.toContain("dashboard-auth-provisioning-uri");
  });

  it("shows the scan heading and helper text", () => {
    const markup = render();
    expect(markup).toContain("Scan with your authenticator app");
    expect(markup).toContain("scan this QR code");
  });

  it("keeps the authenticator-code input and Complete setup action", () => {
    const markup = render();
    expect(markup).toContain("dashboard-auth-setup-code");
    expect(markup).toContain("Complete setup");
  });
});
