# ApplyWizz Auth Landing Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the developer placeholder root page and browser Basic Auth popup with a branded ApplyWizz employee login landing page at `/`, add role-based post-login redirects (including a CA "access pending" holding page), show the real signed-in employee's identity in the app shell, and only then remove Basic Auth.

**Architecture:** Reuse the existing, already-tested `startDashboardLogin` / `verifyDashboardLoginOtp` / `completeDashboardTotpSetup` / `verifyDashboardLoginTotp` auth flow and the existing `DashboardAuthClient` component's business logic unchanged. Add a pure `resolveRootRedirect(role)` helper, move the session-check-and-redirect logic from `/dashboard/login` to `/` (root), restyle `DashboardAuthClient` into a branded two-column layout with single-step display, add a new `/access-pending` route for CA users, thread real session identity into the operations sidebar, and remove Basic Auth from `middleware.ts` only in the final task.

**Tech Stack:** Next.js App Router, React Server/Client Components, Vitest, existing `lib/dashboardAuth/*` modules.

## Global Constraints

- Only three roles exist: `admin_ceo`, `manager_ops`, `ca`. No `staff`/`user`/`super_user` wording or role picker.
- The browser never selects or submits a role; role resolution is server-side only (already true via `startDashboardLogin` / `resolveAutoProvisionRole` from the merged auto-provisioning work).
- Existing users' stored role/status/TOTP secret must never be overwritten by this work.
- CA sessions must land on `/access-pending`, never on `/live-monitor/email-arrival` or any broad-operations route, until CA-level data scoping is implemented separately (out of scope here).
- Admin and manager sessions land on `/live-monitor/email-arrival` for this release.
- Do not implement CA data scoping, manager-to-CA Router mapping, Zoho ingestion changes, Leads sync changes, or Render changes.
- Do not remove Basic Auth until every other task in this plan is implemented and its tests pass.
- Do not deploy. Do not access Production. Work happens only on `feature/dashboard-auth-landing-experience`, branched from the current `origin/main` (which already includes the merged dashboard-login-auto-provisioning work).
- Never log OTP values, TOTP secrets, session tokens, or cookies.

---

## Current Behavior, Corrected

- `app/page.tsx` is a static developer placeholder ("ApplyWizard Email Tracker", `npm run dev`, "Open COO Overview" link) — not session-aware at all.
- `app/dashboard/login/page.tsx` already does the session-check-and-redirect-else-render-login pattern this plan wants at `/`, but redirects every valid session straight to `/overview` regardless of role, and always renders `DashboardAuthClient` with no branded landing chrome.
- `DashboardAuthClient` (`components/dashboard-auth/dashboard-auth-client.tsx`) already implements the full OTP/TOTP business logic correctly, including routing returning `totp_enabled` users straight to the authenticator-code step with no email OTP (via `nextStep === "totp"` from `startDashboardLogin`). It already hides the TOTP setup key behind a "Show setup key" toggle. What it lacks is: a branded two-column layout, a visible step-tabs strip (`dashboard-auth-steps`) that must be replaced with a single-step view plus a small progress indicator only for first-time setup, a masked-email/resend-countdown OTP screen, and a success transition screen.
- `app/(operations)/layout.tsx` is a client component with a working `handleLogout` (already calls `/api/dashboard/auth/logout` and redirects to `/dashboard/login`) but hardcodes `Operations Room` / `Super Admin` as the sidebar identity — there is no real session data flowing into it.
- `middleware.ts` protects `/dashboard`, `/overview`, `/live-monitor`, `/clients`, `/operations`, `/review-queue` with Basic Auth, but its matcher **does not include `/ca-portfolio`**, which is a real, pre-existing gap.
- `requireDashboardSession()` (`lib/dashboardAuth/requireDashboardSession.ts`) already fails closed (redirects to `/dashboard/login` on any missing/invalid/errored session) and is already called at the top of every operations page (`clients/page.tsx`, `live-monitor/email-arrival/page.tsx`, etc.).

## File Structure

- Create: `lib/dashboardAuth/rootRedirect.ts` — pure `resolveRootRedirect(role)` helper.
- Create: `lib/dashboardAuth/rootRedirect.test.ts`
- Modify: `app/page.tsx` — becomes the session-check-and-redirect-or-render-landing entry point (replaces the developer placeholder entirely).
- Modify: `app/dashboard/login/page.tsx` — becomes a thin redirect to `/` (single canonical login URL), preserving the existing route for any bookmarks/links.
- Create: `app/access-pending/page.tsx` — CA holding page, session-protected.
- Create: `app/access-pending/page.test.tsx`
- Modify: `components/dashboard-auth/dashboard-auth-client.tsx` — branded two-column layout, single active step, masked email + resend countdown on the OTP step, success transition screen.
- Modify: `components/dashboard-auth/dashboard-auth-client.test.tsx` (create if absent) — cover masked email, resend countdown, success transition.
- Modify: `app/(operations)/layout.tsx` → split into `app/(operations)/layout.tsx` (server component, fetches session) and `components/operations/operations-shell-client.tsx` (existing client UI, now takes `userName`/`userRole` props).
- Create: `components/operations/operations-shell-client.test.tsx`
- Modify: `middleware.ts` — add `/ca-portfolio` to the protected matcher (before Basic Auth removal, so the gap is fixed and tested first); then, in the final task, remove the Basic Auth check entirely.
- Modify: `middleware.test.ts` (create if absent) — protected-route coverage, including the fixed `/ca-portfolio` gap and (final task) confirming no `WWW-Authenticate` header is issued.
- Modify: `app/api/dashboard/auth/logout/route.ts` — remove its `requireDashboardBasicAuth` call in the final task (Basic Auth is going away; the route is already origin-checked and session-scoped, which is sufficient).

---

### Task 1: Root Redirect Resolver

**Files:**
- Create: `lib/dashboardAuth/rootRedirect.ts`
- Create: `lib/dashboardAuth/rootRedirect.test.ts`

**Interfaces:**
- Produces: `export function resolveRootRedirect(role: DashboardRole): string;`

- [ ] **Step 1: Write the failing test**

Create `lib/dashboardAuth/rootRedirect.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

describe("resolveRootRedirect", () => {
  it("sends admin_ceo to the live monitor", async () => {
    const { resolveRootRedirect } = await import("./rootRedirect");
    expect(resolveRootRedirect("admin_ceo")).toBe("/live-monitor/email-arrival");
  });

  it("sends manager_ops to the live monitor", async () => {
    const { resolveRootRedirect } = await import("./rootRedirect");
    expect(resolveRootRedirect("manager_ops")).toBe("/live-monitor/email-arrival");
  });

  it("sends ca to the access-pending holding page", async () => {
    const { resolveRootRedirect } = await import("./rootRedirect");
    expect(resolveRootRedirect("ca")).toBe("/access-pending");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run lib/dashboardAuth/rootRedirect.test.ts`
Expected: FAIL with `Cannot find module './rootRedirect'`.

- [ ] **Step 3: Implement the resolver**

Create `lib/dashboardAuth/rootRedirect.ts`:

```typescript
import "server-only";

import type { DashboardRole } from "@/lib/dashboardAuth/users";

export function resolveRootRedirect(role: DashboardRole): string {
  if (role === "ca") return "/access-pending";
  return "/live-monitor/email-arrival";
}
```

- [ ] **Step 4: Run focused verification**

Run: `npx vitest run lib/dashboardAuth/rootRedirect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboardAuth/rootRedirect.ts lib/dashboardAuth/rootRedirect.test.ts
git commit -m "feat: add role-based dashboard redirect resolver"
```

---

### Task 2: CA Access-Pending Route

**Files:**
- Create: `app/access-pending/page.tsx`
- Create: `app/access-pending/page.test.tsx`
- Modify: `middleware.ts` (add `/access-pending` to the protected matcher)

**Interfaces:**
- Consumes: `requireDashboardSession()` from `lib/dashboardAuth/requireDashboardSession.ts` (existing, unchanged signature: `(): Promise<DashboardSession>`).

- [ ] **Step 1: Write the failing test**

Create `app/access-pending/page.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";

const requireDashboardSession = vi.fn();

vi.mock("@/lib/dashboardAuth/requireDashboardSession", () => ({
  requireDashboardSession,
}));

describe("AccessPendingPage", () => {
  it("requires a dashboard session before rendering", async () => {
    requireDashboardSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      revokedAt: null,
      user: { id: "user-1", email: "ca@applywizz.ai", role: "ca", status: "active", totpEnabled: true },
    });

    const { default: AccessPendingPage } = await import("./page");
    const element = await AccessPendingPage();

    expect(requireDashboardSession).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(element)).toContain("Your ApplyWizz account is active");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run app/access-pending/page.test.tsx`
Expected: FAIL — `app/access-pending/page.tsx` does not exist.

- [ ] **Step 3: Implement the page**

Create `app/access-pending/page.tsx`:

```tsx
import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AccessPendingPage() {
  await requireDashboardSession();

  return (
    <main className="access-pending-shell" data-testid="access-pending-shell">
      <div className="access-pending-card">
        <h1>Your ApplyWizz account is active.</h1>
        <p>Your client access is being prepared.</p>
        <p>Contact your manager if you need immediate assistance.</p>
      </div>
      <style>{`
        .access-pending-shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background: #0B1D33;
          color: #F5F5F5;
        }
        .access-pending-card {
          max-width: 420px;
          text-align: center;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          padding: 32px;
        }
        .access-pending-card h1 {
          font-size: 1.4rem;
          margin-bottom: 12px;
        }
        .access-pending-card p {
          color: #cbd5e1;
          margin: 6px 0;
        }
      `}</style>
    </main>
  );
}
```

- [ ] **Step 4: Add `/access-pending` to the protected matcher**

In `middleware.ts`, update `PROTECTED_PATHS` and `config.matcher`:

```typescript
const PROTECTED_PATHS = [
  "/dashboard",
  "/overview",
  "/live-monitor",
  "/clients",
  "/operations",
  "/review-queue",
  "/ca-portfolio",
  "/access-pending",
];
```

```typescript
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/overview",
    "/live-monitor",
    "/live-monitor/:path*",
    "/clients/:path*",
    "/operations/:path*",
    "/review-queue",
    "/ca-portfolio/:path*",
    "/access-pending",
  ],
};
```

This also fixes the pre-existing `/ca-portfolio` matcher gap noted in Current Behavior.

- [ ] **Step 5: Run focused verification**

```bash
npx vitest run app/access-pending/page.test.tsx
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/access-pending/page.tsx app/access-pending/page.test.tsx middleware.ts
git commit -m "feat: add CA access-pending route and close ca-portfolio matcher gap"
```

---

### Task 3: Root Page Becomes the Auth Entry Point

**Files:**
- Modify: `app/page.tsx`
- Create: `app/page.test.tsx`
- Modify: `app/dashboard/login/page.tsx`
- Modify: `app/dashboard/login/page.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `getDashboardSessionByToken(rawToken)` from `lib/dashboardAuth/sessionStore.ts` (existing) → `{ ok: true; session: DashboardSession } | { ok: false }`, where `DashboardSession.user.role` is `DashboardRole`.
- Consumes: `resolveRootRedirect(role)` from Task 1.
- Consumes: `DASHBOARD_SESSION_COOKIE_NAME` from `lib/dashboardAuth/sessionCookie.ts` (existing).
- Consumes: `DashboardAuthClient` from `components/dashboard-auth/dashboard-auth-client.tsx` (existing, restyled in Task 4).

- [ ] **Step 1: Write the failing test**

Create `app/page.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";

const getDashboardSessionByToken = vi.fn();
const cookieGet = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet }),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/dashboardAuth/sessionStore", () => ({ getDashboardSessionByToken }));
vi.mock("@/components/dashboard-auth/dashboard-auth-client", () => ({
  DashboardAuthClient: () => "DashboardAuthClient",
}));

function session(role: "admin_ceo" | "manager_ops" | "ca") {
  return {
    ok: true as const,
    session: {
      id: "session-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      revokedAt: null,
      user: { id: "user-1", email: "user@applywizz.ai", role, status: "active" as const, totpEnabled: true },
    },
  };
}

describe("Home (root page)", () => {
  it("renders the login landing page when there is no session cookie", async () => {
    cookieGet.mockReturnValue(undefined);
    const { default: Home } = await import("./page");
    const element = await Home();
    expect(JSON.stringify(element)).toContain("DashboardAuthClient");
  });

  it("redirects an admin session to the live monitor", async () => {
    cookieGet.mockReturnValue({ value: "raw-token" });
    getDashboardSessionByToken.mockResolvedValue(session("admin_ceo"));
    const { default: Home } = await import("./page");
    await expect(Home()).rejects.toThrow("REDIRECT:/live-monitor/email-arrival");
  });

  it("redirects a ca session to access-pending", async () => {
    cookieGet.mockReturnValue({ value: "raw-token" });
    getDashboardSessionByToken.mockResolvedValue(session("ca"));
    const { default: Home } = await import("./page");
    await expect(Home()).rejects.toThrow("REDIRECT:/access-pending");
  });

  it("renders the landing page for an invalid or expired session instead of throwing", async () => {
    cookieGet.mockReturnValue({ value: "raw-token" });
    getDashboardSessionByToken.mockResolvedValue({ ok: false });
    const { default: Home } = await import("./page");
    const element = await Home();
    expect(JSON.stringify(element)).toContain("DashboardAuthClient");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run app/page.test.tsx`
Expected: FAIL — current `app/page.tsx` renders the developer placeholder, not `DashboardAuthClient`, and never redirects.

- [ ] **Step 3: Implement the root page**

Replace all of `app/page.tsx` with:

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { DashboardAuthClient } from "@/components/dashboard-auth/dashboard-auth-client";
import { getDashboardSessionByToken } from "@/lib/dashboardAuth/sessionStore";
import { DASHBOARD_SESSION_COOKIE_NAME } from "@/lib/dashboardAuth/sessionCookie";
import { resolveRootRedirect } from "@/lib/dashboardAuth/rootRedirect";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const cookieStore = await cookies();
  const rawSessionToken = cookieStore.get(DASHBOARD_SESSION_COOKIE_NAME)?.value;

  if (rawSessionToken) {
    let sessionResult: Awaited<ReturnType<typeof getDashboardSessionByToken>> | null = null;
    try {
      sessionResult = await getDashboardSessionByToken(rawSessionToken);
    } catch {
      // Fail closed: render the login landing page.
    }

    if (sessionResult?.ok) {
      redirect(resolveRootRedirect(sessionResult.session.user.role));
    }
  }

  return <DashboardAuthClient />;
}
```

- [ ] **Step 4: Make `/dashboard/login` a thin redirect to `/`**

Replace all of `app/dashboard/login/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default function DashboardLoginRedirect() {
  redirect("/");
}
```

Delete the now-redundant `app/dashboard/login/page.test.tsx` if it asserts on the old inline behavior; the redirect is trivial enough not to need its own test (single `redirect()` call, no branching logic).

- [ ] **Step 5: Run focused verification**

```bash
npx vitest run app/page.test.tsx
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS. If `app/dashboard/login/page.test.tsx` fails because it tested the old inline logic, delete it (its behavior moved to `app/page.test.tsx`).

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx app/page.test.tsx app/dashboard/login/page.tsx
git rm -f app/dashboard/login/page.test.tsx 2>/dev/null || true
git commit -m "feat: make root the session-aware login and redirect entry point"
```

---

### Task 4: Branded Landing Layout for DashboardAuthClient

**Files:**
- Modify: `components/dashboard-auth/dashboard-auth-client.tsx`

**Interfaces:**
- No exported signatures change. `DashboardAuthClient` still takes no props. Internal `AuthStep` union, state, and handlers (`handleRequestOtp`, `handleVerifyOtp`, `handleCompleteSetup`, `handleLogin`) are unchanged — only JSX structure, CSS, and copy change.

This task is presentation-only: no new business logic, so it is verified by keeping all existing `components/dashboard-auth/*.test.tsx` assertions passing (they assert on `data-testid` attributes and behavior, not exact copy/layout), plus one new test for the single-step-visible requirement.

- [ ] **Step 1: Write the failing test**

Add to `components/dashboard-auth/dashboard-auth-client.test.tsx` (create the file if it does not exist yet, importing the existing render setup pattern used in `authenticator-setup.test.tsx` in the same directory):

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

describe("DashboardAuthClient landing layout", () => {
  it("shows only the email step's heading, not a visible step-tabs strip", async () => {
    const { DashboardAuthClient } = await import("./dashboard-auth-client");
    render(<DashboardAuthClient />);

    expect(screen.getByTestId("dashboard-auth-email")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run components/dashboard-auth/dashboard-auth-client.test.tsx`
Expected: FAIL — the current component renders `<section className="dashboard-auth-steps" aria-label="Authentication steps">` containing four always-visible `role="tablist"` step chips.

- [ ] **Step 3: Restyle the component**

In `components/dashboard-auth/dashboard-auth-client.tsx`:

1. Delete the entire `<section className="dashboard-auth-steps" ...>...</section>` block (the four-chip strip) and the now-unused `steps`/`activeStepIndex` variables and the `StepChip` function.
2. Wrap the existing `<div className="dashboard-auth-panel">...</div>` in a two-column shell. Replace the outer `<main className="dashboard-auth-shell" ...>` open tag's children with:

```tsx
<main className="dashboard-auth-shell" data-testid="dashboard-auth-shell" data-step={step}>
  <div className="dashboard-auth-layout">
    <aside className="dashboard-auth-brand-panel">
      <div className="dashboard-auth-brand-mark">ApplyWizz</div>
      <p className="dashboard-auth-brand-tagline">Your Career Partner</p>
      <h2 className="dashboard-auth-brand-heading">Email Operations Console</h2>
      <p className="dashboard-auth-brand-copy">
        Real-time visibility into client emails, classification activity and operations.
      </p>
      <ul className="dashboard-auth-trust-list">
        <li>Secure</li>
        <li>Private</li>
        <li>Real-time</li>
        <li>Internal Use Only</li>
      </ul>
    </aside>

    <div className="dashboard-auth-panel">
      {/* existing header/error/step-form content stays here, unchanged except removing the subtitle line and step-tabs section already handled above */}
    </div>
  </div>
</main>
```

3. For the first-time-setup progress indicator (only shown once a first-time user has left the email step), add directly above the per-step form, inside `dashboard-auth-panel`, gated on `step !== "email" && step !== "login"` (the two-step returning-user path never shows it):

```tsx
{(step === "otp" || step === "setup") ? (
  <ol className="dashboard-auth-progress" aria-label="Setup progress">
    <li className={step === "otp" || step === "setup" ? "done" : ""}>1. Verify Email</li>
    <li className={step === "setup" ? "done" : ""}>2. Secure Account</li>
    <li>3. Complete</li>
  </ol>
) : null}
```

4. Add the CSS for `.dashboard-auth-layout` (two-column grid, collapsing to one column under 900px), `.dashboard-auth-brand-panel`, `.dashboard-auth-trust-list`, and `.dashboard-auth-progress` to the existing `<style>{\`...\`}</style>` block, using the brand palette from the global constraints (`#0B1D33` navy, `#2C76FF` blue, `#29FE29` green accents, `Noto Sans` typography already available via the operations shell's font imports — import `Noto_Sans` from `next/font/google` at the top of this file the same way `app/(operations)/layout.tsx` does).

- [ ] **Step 4: Run focused verification**

```bash
npx vitest run components/dashboard-auth
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS. All existing `dashboard-auth-*` `data-testid` hooks must still exist (email input, otp input, setup code input, login code input, QR code, show-setup-key button) since no handler logic changed.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard-auth/dashboard-auth-client.tsx components/dashboard-auth/dashboard-auth-client.test.tsx
git commit -m "feat: give the dashboard login flow a branded single-step landing layout"
```

---

### Task 5: Masked Email, Resend Countdown, and Success Transition

**Files:**
- Modify: `components/dashboard-auth/dashboard-auth-client.tsx`
- Modify: `components/dashboard-auth/dashboard-auth-client.test.tsx`

**Interfaces:**
- No new exports. Adds internal state: `resendSecondsLeft: number`, `showSuccessTransition: boolean`.

- [ ] **Step 1: Write the failing tests**

Add to `components/dashboard-auth/dashboard-auth-client.test.tsx`:

```typescript
it("masks the email on the OTP step", async () => {
  const { DashboardAuthClient } = await import("./dashboard-auth-client");
  const { default: userEvent } = await import("@testing-library/user-event");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, nextStep: "email_otp", challengeId: "otp-1" }),
    }),
  );

  render(<DashboardAuthClient />);
  const user = userEvent.setup();
  await user.type(screen.getByTestId("dashboard-auth-email"), "ramakrishna@applywizz.ai");
  await user.click(screen.getByRole("button", { name: /send otp/i }));

  expect(await screen.findByText(/r\*+a@applywizz\.ai/i)).toBeInTheDocument();
  vi.unstubAllGlobals();
});

it("disables resend for 30 seconds after requesting an OTP", async () => {
  const { DashboardAuthClient } = await import("./dashboard-auth-client");
  const { default: userEvent } = await import("@testing-library/user-event");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, nextStep: "email_otp", challengeId: "otp-1" }),
    }),
  );

  render(<DashboardAuthClient />);
  const user = userEvent.setup();
  await user.type(screen.getByTestId("dashboard-auth-email"), "ramakrishna@applywizz.ai");
  await user.click(screen.getByRole("button", { name: /send otp/i }));

  expect(await screen.findByTestId("dashboard-auth-resend")).toBeDisabled();
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npx vitest run components/dashboard-auth/dashboard-auth-client.test.tsx`
Expected: FAIL — no masked email text and no `dashboard-auth-resend` element exist yet.

- [ ] **Step 3: Implement masking and the resend countdown**

In `components/dashboard-auth/dashboard-auth-client.tsx`, add a pure helper near the top-level helpers (alongside `sanitizeNumeric`):

```typescript
function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return value;
  if (local.length <= 2) return `${local[0] ?? ""}***@${domain}`;
  return `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}@${domain}`;
}
```

Add state inside `DashboardAuthClient`:

```typescript
const [submittedEmail, setSubmittedEmail] = useState("");
const [resendSecondsLeft, setResendSecondsLeft] = useState(0);
```

In `handleRequestOtp`, after a successful `email_otp` response, set `setSubmittedEmail(trimmedEmail)` and start the countdown:

```typescript
setSubmittedEmail(trimmedEmail);
setResendSecondsLeft(30);
```

Add a countdown effect (import `useEffect` from `"react"` alongside the existing hooks):

```typescript
useEffect(() => {
  if (resendSecondsLeft <= 0) return;
  const timer = setInterval(() => {
    setResendSecondsLeft((seconds) => Math.max(0, seconds - 1));
  }, 1000);
  return () => clearInterval(timer);
}, [resendSecondsLeft]);
```

In the `step === "otp"` form, add the masked email line and a resend button:

```tsx
<p className="dashboard-auth-masked-email">
  We sent a 6-digit verification code to your ApplyWizz email.
  <br />
  <strong>{maskEmail(submittedEmail)}</strong>
</p>
```

```tsx
<button
  type="button"
  className="dashboard-auth-link-button"
  data-testid="dashboard-auth-resend"
  disabled={resendSecondsLeft > 0 || busy}
  onClick={() => handleRequestOtp({ preventDefault: () => {} } as FormEvent<HTMLFormElement>)}
>
  {resendSecondsLeft > 0 ? `Resend in 00:${String(resendSecondsLeft).padStart(2, "0")}` : "Resend code"}
</button>
```

- [ ] **Step 4: Run focused verification**

```bash
npx vitest run components/dashboard-auth/dashboard-auth-client.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Add the success transition screen**

Add a test that drives the actual returning-user flow end to end and asserts on the redirect timing, not just that the component exists:

```typescript
it("shows a brief success transition before redirecting after TOTP login", async () => {
  const replace = vi.fn();
  const refresh = vi.fn();
  vi.doMock("next/navigation", () => ({
    useRouter: () => ({ replace, refresh }),
  }));
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, nextStep: "totp", challenge: "loginchallengev1_token" }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();

  const { DashboardAuthClient } = await import("./dashboard-auth-client");
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup({ delay: null });

  render(<DashboardAuthClient />);
  await user.type(screen.getByTestId("dashboard-auth-email"), "ramakrishna@applywizz.ai");
  await user.click(screen.getByRole("button", { name: /send otp/i }));
  await screen.findByTestId("dashboard-auth-login-code");

  await user.type(screen.getByTestId("dashboard-auth-login-code"), "123456");
  await user.click(screen.getByRole("button", { name: /sign in/i }));

  await screen.findByTestId("dashboard-auth-success");
  expect(replace).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(800);
  expect(replace).toHaveBeenCalledWith("/");
  expect(refresh).toHaveBeenCalled();

  vi.unstubAllGlobals();
  vi.useRealTimers();
});
```

Implement the transition: add `const [signedInAs, setSignedInAs] = useState("");` and a `showSuccess` boolean. In both `handleCompleteSetup` and `handleLogin`, on success, instead of immediately calling `router.replace("/overview")`, do:

```typescript
setSignedInAs(submittedEmail);
setStep("success");
setTimeout(() => {
  router.replace("/");
  router.refresh();
}, 800);
```

Add `"success"` to the `AuthStep` union and render, when `step === "success"`:

```tsx
{step === "success" ? (
  <div className="dashboard-auth-success" role="status" data-testid="dashboard-auth-success">
    <IconCheck size={32} />
    <h2>You have been signed in successfully.</h2>
    <p>Redirecting you now...</p>
  </div>
) : null}
```

Root `/` already redirects a valid session to the correct role destination (Task 3), so redirecting to `/` here is correct and avoids duplicating role-redirect logic in the client.

- [ ] **Step 6: Run full regression for this task**

```bash
npx vitest run components/dashboard-auth
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard-auth/dashboard-auth-client.tsx components/dashboard-auth/dashboard-auth-client.test.tsx
git commit -m "feat: add masked email, resend countdown, and success transition to login"
```

---

### Task 6: Real Session Identity in the Operations Sidebar

**Files:**
- Create: `components/operations/operations-shell-client.tsx` (moved from `app/(operations)/layout.tsx`)
- Create: `components/operations/operations-shell-client.test.tsx`
- Modify: `app/(operations)/layout.tsx` (becomes a server component)

**Interfaces:**
- Consumes: `requireDashboardSession()` (existing).
- Produces: `OperationsShellClient` accepts `{ userName: string; userRole: "admin_ceo" | "manager_ops" | "ca"; children: React.ReactNode }`.

- [ ] **Step 1: Write the failing test**

Create `components/operations/operations-shell-client.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/overview" }));

describe("OperationsShellClient", () => {
  it("renders the real signed-in employee name and role label", async () => {
    const { OperationsShellClient } = await import("./operations-shell-client");
    render(
      <OperationsShellClient userName="Ramakrishna Chanda" userRole="admin_ceo">
        <div>content</div>
      </OperationsShellClient>,
    );

    expect(screen.getByText("Ramakrishna Chanda")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("labels a manager_ops session as Manager and a ca session as CA", async () => {
    const { OperationsShellClient } = await import("./operations-shell-client");
    const { rerender } = render(
      <OperationsShellClient userName="Balaji" userRole="manager_ops">
        <div>content</div>
      </OperationsShellClient>,
    );
    expect(screen.getByText("Manager")).toBeInTheDocument();

    rerender(
      <OperationsShellClient userName="Navya" userRole="ca">
        <div>content</div>
      </OperationsShellClient>,
    );
    expect(screen.getByText("CA")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run components/operations/operations-shell-client.test.tsx`
Expected: FAIL — `components/operations/operations-shell-client.tsx` does not exist.

- [ ] **Step 3: Move the client shell and thread props through**

Create `components/operations/operations-shell-client.tsx` with the exact current contents of `app/(operations)/layout.tsx` (the whole `"use client"` file, unchanged logic), renamed:

- Rename the default export function from `OperationsLayout` to `OperationsShellClient` and change its signature to:

```typescript
export function OperationsShellClient({
  children,
  userName,
  userRole,
}: {
  children: React.ReactNode;
  userName: string;
  userRole: "admin_ceo" | "manager_ops" | "ca";
}) {
```

- Add a role-label helper near the top of the file:

```typescript
function roleLabel(role: "admin_ceo" | "manager_ops" | "ca"): string {
  if (role === "admin_ceo") return "Admin";
  if (role === "manager_ops") return "Manager";
  return "CA";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
```

- Replace the hardcoded sidebar-footer block:

```tsx
<div className="user-profile">
  <div className="user-avatar">{initials(userName)}</div>
  <div className="user-details">
    <div className="user-name">{userName}</div>
    <div className="user-role">{roleLabel(userRole)}</div>
  </div>
</div>
```

- [ ] **Step 4: Run focused verification**

Run: `npx vitest run components/operations/operations-shell-client.test.tsx`
Expected: PASS.

- [ ] **Step 5: Make `app/(operations)/layout.tsx` a server component**

Replace all of `app/(operations)/layout.tsx` with:

```tsx
import { requireDashboardSession } from "@/lib/dashboardAuth/requireDashboardSession";
import { OperationsShellClient } from "@/components/operations/operations-shell-client";

export default async function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireDashboardSession();

  return (
    <OperationsShellClient userName={session.user.email} userRole={session.user.role}>
      {children}
    </OperationsShellClient>
  );
}
```

This calls `requireDashboardSession()` once per layout render; the existing per-page calls in `clients/page.tsx`, `live-monitor/email-arrival/page.tsx`, etc. remain as an additional defense-in-depth check and are unaffected.

Note: `session.user.email` is used as the display name fallback per the plan's own fallback rule ("ramakrishna@applywizz.ai / Admin"); a real display-name field does not exist on `DashboardUser` today, so the fallback is the only available value — do not invent a `displayName` column or field in this task.

- [ ] **Step 6: Run full regression for this task**

```bash
npx vitest run components/operations
npx vitest run app/\(operations\)
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add components/operations/operations-shell-client.tsx components/operations/operations-shell-client.test.tsx "app/(operations)/layout.tsx"
git commit -m "feat: show the real signed-in employee identity in the operations shell"
```

---

### Task 7: Session-Expired Messaging

**Files:**
- Modify: `lib/dashboardAuth/requireDashboardSession.ts`
- Modify: `lib/dashboardAuth/requireDashboardSession.test.ts` (existing file — extend it)
- Modify: `app/page.tsx`
- Modify: `components/dashboard-auth/dashboard-auth-client.tsx`

**Interfaces:**
- Modifies: `requireDashboardSession()` still returns `Promise<DashboardSession>`, but on a missing/invalid/expired session it now redirects to `/?expired=1` instead of bare `/dashboard/login`.

- [ ] **Step 1: Write the failing test**

In `lib/dashboardAuth/requireDashboardSession.test.ts`, add:

```typescript
it("redirects to the root page with an expired flag when the session is missing", async () => {
  cookieGet.mockReturnValue(undefined);
  const { requireDashboardSession } = await import("./requireDashboardSession");
  await expect(requireDashboardSession()).rejects.toThrow("REDIRECT:/?expired=1");
});
```

(Match this repo's existing mock style for `next/headers`/`next/navigation` already used in that test file — reuse the same `cookieGet` and `redirect` mocks already declared there.)

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run lib/dashboardAuth/requireDashboardSession.test.ts`
Expected: FAIL — current code redirects to `/dashboard/login` with no query flag.

- [ ] **Step 3: Update the redirect target**

In `lib/dashboardAuth/requireDashboardSession.ts`, change the final line:

```typescript
redirect("/?expired=1");
```

- [ ] **Step 4: Read the flag on the root page**

In `app/page.tsx`, accept `searchParams` and pass an `expired` flag into `DashboardAuthClient`:

```typescript
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const expired = params.expired === "1";
  // ...existing cookie/session logic unchanged...
  return <DashboardAuthClient initialError={expired ? "Your session has expired. Please sign in again." : ""} />;
}
```

- [ ] **Step 5: Accept the prop in `DashboardAuthClient`**

Change the export signature:

```typescript
export function DashboardAuthClient({ initialError = "" }: { initialError?: string } = {}) {
  // ...
  const [error, setError] = useState(initialError);
```

- [ ] **Step 6: Run focused verification**

```bash
npx vitest run lib/dashboardAuth/requireDashboardSession.test.ts
npx vitest run app/page.test.tsx
npx vitest run components/dashboard-auth
npx vitest run
npm run lint
npm run build
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/dashboardAuth/requireDashboardSession.ts lib/dashboardAuth/requireDashboardSession.test.ts app/page.tsx components/dashboard-auth/dashboard-auth-client.tsx
git commit -m "feat: show a session-expired notice on the login landing page"
```

---

### Task 8: Remove Basic Auth and the Legacy Root Content

**Files:**
- Modify: `middleware.ts`
- Modify: `middleware.test.ts` (create if it does not already exist, covering the matcher)
- Modify: `app/api/dashboard/auth/logout/route.ts`
- Modify: `app/api/dashboard/auth/logout/route.test.ts` (existing — remove Basic-Auth-specific assertions)
- Modify: `app/api/dashboard/auth/request-otp/route.ts` and its sibling verify-otp/verify-totp/complete-totp-setup routes (remove `requireDashboardBasicAuth` calls)
- Modify: each of those routes' `.test.tsx`/`.test.ts` files (remove Basic-Auth-specific assertions)

**Do this task last.** Every prior task's tests must be green before starting this one — this is the "fail-closed during the transition" requirement: session-based protection (`requireDashboardSession` in every operations page/layout, plus the middleware's own `/access-pending`, `/ca-portfolio`, etc. matcher entries) must already be fully in place and tested before Basic Auth is removed, so no route is ever briefly unprotected.

- [ ] **Step 1: Write the failing middleware test**

Create or extend `middleware.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

describe("middleware", () => {
  it("no longer issues a Basic Auth challenge for protected paths", () => {
    const request = new NextRequest("https://email-apply-wizz.test/overview");
    const response = middleware(request);
    expect(response.headers.get("WWW-Authenticate")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npx vitest run middleware.test.ts`
Expected: FAIL — the current middleware still returns a 401 with `WWW-Authenticate` for `/overview` without Basic Auth credentials.

- [ ] **Step 3: Remove Basic Auth from the middleware**

Replace all of `middleware.ts` with:

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
```

Route-level protection now rests entirely on `requireDashboardSession()`, which every operations page and layout already calls (Tasks 2, 6, and the pre-existing per-page calls in `clients/page.tsx`, `live-monitor/email-arrival/page.tsx`, `operations/`, `review-queue/`, `ca-portfolio/` — verify each of these still calls it; add the call to any page that is missing it before proceeding).

- [ ] **Step 4: Remove Basic Auth from the dashboard-auth API routes**

In `app/api/dashboard/auth/request-otp/route.ts`, `verify-otp/route.ts`, `verify-totp/route.ts`, `complete-totp-setup/route.ts`, and `logout/route.ts`: delete the `requireDashboardBasicAuth` import and its call at the top of each `POST` handler. These routes remain protected by their own logic (rate limiting, origin checks, session cookie checks where applicable) — they do not need Basic Auth once the browser-level gate is gone, since they were never meant to be called by anyone without going through the login UI first.

- [ ] **Step 5: Update each route's tests**

In each of those routes' test files, delete the `it("returns 401 before ... when Basic Auth is missing", ...)` test and remove the `authorization: basicAuth(...)` header from every remaining request in that file (the routes no longer check it).

- [ ] **Step 6: Delete the old developer root-page remnants**

Confirm `app/page.tsx` (already replaced in Task 3) contains no reference to `npm run dev`, `Open COO Overview`, `Zoho OAuth`, `AI Classification`, or `Supabase Storage`. If any remain, remove them — Task 3 already replaced the whole file, so this step is a verification, not new work:

```bash
grep -n "Open COO Overview\|npm run dev\|Coming in Phase" app/page.tsx
```

Expected: no matches.

- [ ] **Step 7: Run full regression**

```bash
npx vitest run
npm run lint
npm run build
git diff --check
git status --short
```

Expected: all tests pass, lint passes, build passes, diff-check passes, clean working tree after commit.

- [ ] **Step 8: Commit**

```bash
git add middleware.ts middleware.test.ts app/api/dashboard/auth
git commit -m "chore: remove Basic Auth now that session-based route protection is verified"
```

---

## Self-Review

**Corrected assumptions:**
- Most of the OTP/TOTP business logic (auto-provisioning, returning-TOTP-user shortcut, no-fake-OTP, role resolution) already shipped in the merged dashboard-login-auto-provisioning work and is reused, not rebuilt.
- Sign-out already works end-to-end (`app/(operations)/layout.tsx`'s `handleLogout`); this plan only threads real identity into the same component, it does not rebuild sign-out.
- The TOTP setup screen already hides the setup key behind a toggle by default; this plan only restyles its container, not its logic.
- `/ca-portfolio` was missing from the middleware matcher — a real, pre-existing gap independent of this feature, fixed in Task 2.

**Spec coverage:**
- Root behavior by session state → Task 3, Task 7.
- Role-based redirects (admin/manager → Live Monitor, CA → Access Pending) → Task 1, Task 2, Task 3.
- Branded two-column landing, single visible step, progress indicator for setup only → Task 4.
- Masked email, resend countdown → Task 5.
- Success transition screen → Task 5.
- Real employee identity + role label in the shell → Task 6.
- Session-expired notice → Task 7.
- Route protection audit (including the `/ca-portfolio` gap) → Task 2, Task 8.
- Basic Auth removed only after everything else is verified → Task 8 (last).
- Old developer root content removed → Task 3, verified in Task 8.

**Scope check (explicitly excluded, unchanged from the global constraints):**
- CA-level data scoping, manager-to-CA Router mapping, Zoho ingestion, Leads sync, Render, Production deployment, Production database writes are all out of scope and untouched by every task above.

**Placeholder scan:** No TBD/TODO markers; every step shows complete code, not a description of code.

**Type consistency:** `resolveRootRedirect(role: DashboardRole): string` (Task 1) is consumed with the exact same signature in Task 3's `app/page.tsx`. `OperationsShellClient({ userName, userRole, children })` (Task 6) matches its only call site in `app/(operations)/layout.tsx`. `DashboardAuthClient({ initialError })` (Task 7) matches its only call site in `app/page.tsx`.
