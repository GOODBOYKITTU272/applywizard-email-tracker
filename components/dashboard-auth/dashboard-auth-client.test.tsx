import type { FormEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe("DashboardAuthClient landing layout", () => {
  it("shows only the email step's heading, not a visible step-tabs strip", async () => {
    const { DashboardAuthClient } = await import("./dashboard-auth-client");
    const markup = renderToStaticMarkup(<DashboardAuthClient />);

    expect(markup).toContain('data-testid="dashboard-auth-email"');
    expect(markup).not.toContain("Authentication steps");
    expect(markup).not.toContain("dashboard-auth-steps");
  });

  it("does not show the setup progress indicator on the email step", async () => {
    const { DashboardAuthClient } = await import("./dashboard-auth-client");
    const markup = renderToStaticMarkup(<DashboardAuthClient />);

    expect(markup).not.toContain('aria-label="Setup progress"');
  });
});

// The brief's literal tests for masking/resend/success-transition drive the
// stateful client component through real user interactions (type an email,
// click "Send OTP", wait for a countdown, advance fake timers past a
// setTimeout-based redirect) using @testing-library/react + userEvent. As
// established by the shouldShowSetupProgress tests above, this repo's vitest
// "node" environment has neither of those installed, and renderToStaticMarkup
// has no event system and does not run effects, so none of that is possible
// here. Each behavior below is instead tested at the smallest unit that
// actually carries the logic: a pure function, or a small extracted
// presentational component driven by explicit props via renderToStaticMarkup.
describe("maskEmail", () => {
  it("masks a long local-part, keeping first and last character", async () => {
    const { maskEmail } = await import("./dashboard-auth-client");

    expect(maskEmail("ramakrishna@applywizz.ai")).toMatch(/^r\*+a@applywizz\.ai$/);
  });

  it("handles a 1-character local-part without crashing", async () => {
    const { maskEmail } = await import("./dashboard-auth-client");

    expect(maskEmail("a@applywizz.ai")).toBe("a***@applywizz.ai");
  });

  it("handles a 2-character local-part without crashing", async () => {
    const { maskEmail } = await import("./dashboard-auth-client");

    expect(maskEmail("ab@applywizz.ai")).toBe("a***@applywizz.ai");
  });

  it("returns the input unchanged when there is no '@'", async () => {
    const { maskEmail } = await import("./dashboard-auth-client");

    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });

  it("returns the input unchanged for an empty string", async () => {
    const { maskEmail } = await import("./dashboard-auth-client");

    expect(maskEmail("")).toBe("");
  });
});

describe("nextResendSeconds", () => {
  it("counts down by one each call", async () => {
    const { nextResendSeconds } = await import("./dashboard-auth-client");

    expect(nextResendSeconds(30)).toBe(29);
    expect(nextResendSeconds(1)).toBe(0);
  });

  it("floors at zero and never goes negative", async () => {
    const { nextResendSeconds } = await import("./dashboard-auth-client");

    expect(nextResendSeconds(0)).toBe(0);
  });
});

describe("OtpVerificationStep", () => {
  async function render(overrides: Record<string, unknown> = {}) {
    const { OtpVerificationStep } = await import("./dashboard-auth-client");
    return renderToStaticMarkup(
      <OtpVerificationStep
        submittedEmail="ramakrishna@applywizz.ai"
        resendSecondsLeft={0}
        otp=""
        busy={false}
        onCodeChange={() => {}}
        onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
        onReset={() => {}}
        onResend={() => {}}
        {...overrides}
      />,
    );
  }

  it("shows the masked email, not the raw email", async () => {
    const markup = await render();

    expect(markup).toMatch(/r\*+a@applywizz\.ai/i);
    expect(markup).not.toContain("ramakrishna@applywizz.ai");
  });

  it("disables the resend button and shows a countdown while resendSecondsLeft > 0", async () => {
    const markup = await render({ resendSecondsLeft: 30 });

    expect(markup).toContain('data-testid="dashboard-auth-resend"');
    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("Resend in 00:30");
  });

  it("re-enables the resend button once resendSecondsLeft reaches zero", async () => {
    const markup = await render({ resendSecondsLeft: 0, busy: false });

    // With resendSecondsLeft at 0 and busy false, nothing on this step should
    // be disabled -- the resend button is the only element whose `disabled`
    // depends on resendSecondsLeft, so this is an unambiguous check.
    expect(markup).not.toContain("disabled=\"\"");
    expect(markup).toContain("Resend code");
  });
});

describe("SuccessTransition", () => {
  it("renders the success message with the masked signed-in email", async () => {
    const { SuccessTransition } = await import("./dashboard-auth-client");
    const markup = renderToStaticMarkup(<SuccessTransition signedInAs="ramakrishna@applywizz.ai" />);

    expect(markup).toContain('data-testid="dashboard-auth-success"');
    expect(markup).toContain("signed in successfully");
    // Consistent with the OTP step's masking: the raw email is never shown.
    expect(markup).toContain("r*********a@applywizz.ai");
    expect(markup).not.toContain("ramakrishna@applywizz.ai");
  });
});

describe("scheduleSuccessRedirect", () => {
  it("redirects to / and refreshes after the delay, not before", async () => {
    const { scheduleSuccessRedirect } = await import("./dashboard-auth-client");
    const replace = vi.fn();
    const refresh = vi.fn();

    vi.useFakeTimers();
    try {
      scheduleSuccessRedirect({ replace, refresh }, 800);

      vi.advanceTimersByTime(799);
      expect(replace).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(replace).toHaveBeenCalledWith("/");
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("shouldShowSetupProgress", () => {
  // DashboardAuthClient is a stateful client component reached only via
  // clicks/form submits (email -> otp/login -> setup). This repo's vitest
  // environment is "node" with no @testing-library/react or jsdom installed,
  // so renderToStaticMarkup (a one-shot static render with no event system)
  // cannot drive it through those steps: there is no way to fire the
  // onSubmit handlers that call setStep from outside the component. The
  // core "progress indicator only for the first-time-setup path, not the
  // returning-user path" requirement is gated by a single pure predicate
  // (shouldShowSetupProgress), exported specifically so that requirement is
  // unit-testable for every step value without needing DOM simulation. This
  // directly guards against e.g. the `||` in its body being flipped to `&&`.
  it("is true for the first-time-setup steps (otp, setup)", async () => {
    const { shouldShowSetupProgress } = await import("./dashboard-auth-client");

    expect(shouldShowSetupProgress("otp")).toBe(true);
    expect(shouldShowSetupProgress("setup")).toBe(true);
  });

  it("is false for the email step and the returning-user login step", async () => {
    const { shouldShowSetupProgress } = await import("./dashboard-auth-client");

    expect(shouldShowSetupProgress("email")).toBe(false);
    expect(shouldShowSetupProgress("login")).toBe(false);
  });
});
