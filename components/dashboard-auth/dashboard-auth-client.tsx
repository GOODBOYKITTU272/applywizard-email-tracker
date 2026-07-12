"use client";

import { type ChangeEvent, type FormEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { IconArrowRight, IconCheck, IconMail, IconRefresh, IconWarning } from "@/components/icons";

type AuthStep = "email" | "otp" | "setup" | "login";

type RequestOtpResponse = { ok: true; otpId: string } | { ok: false };
type VerifyOtpResponse =
  | {
      ok: true;
      stage: "totp_setup_required";
      challenge: string;
      totpSecret: string;
      provisioningUri: string;
    }
  | {
      ok: true;
      stage: "totp_required";
      challenge: string;
    }
  | { ok: false };
type GenericOkResponse = { ok: true } | { ok: false };

const GENERIC_FAILURE = "Sign-in failed. Try again.";

function sanitizeNumeric(value: string, maxLength: number): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

async function postJson<T>(path: string, payload: unknown): Promise<{ ok: boolean; data: T | null }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
    });

    let data: T | null = null;
    try {
      data = (await response.json()) as T;
    } catch {
      data = null;
    }

    if (!response.ok || !data || typeof data !== "object") {
      return { ok: false, data: null };
    }

    return { ok: true, data };
  } catch {
    return { ok: false, data: null };
  }
}

function StepChip({
  active,
  done,
  label,
  icon,
}: {
  active?: boolean;
  done?: boolean;
  label: string;
  icon: ReactNode;
}) {
  return (
    <div className={`dashboard-auth-step ${active ? "active" : ""} ${done ? "done" : ""}`}>
      <span className="dashboard-auth-step__icon">{icon}</span>
      <span className="dashboard-auth-step__label">{label}</span>
      {done ? <IconCheck size={14} className="dashboard-auth-step__check" /> : null}
    </div>
  );
}

export function AuthenticatorSetup({
  provisioningUri,
  totpSecret,
  setupCode,
  busy,
  onCodeChange,
  onSubmit,
  onReset,
}: {
  provisioningUri: string;
  totpSecret: string;
  setupCode: string;
  busy: boolean;
  onCodeChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
}) {
  // Reveal state lives here so it unmounts (and clears) whenever the flow
  // leaves the setup step — no manual teardown needed on success/restart.
  const [showSetupKey, setShowSetupKey] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyKey() {
    try {
      await navigator.clipboard?.writeText(totpSecret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <form className="dashboard-auth-form" onSubmit={onSubmit}>
      <h2 className="dashboard-auth-step-heading">Scan with your authenticator app</h2>
      {/* The provisioning URI (which embeds the secret) is encoded into the QR
          modules only — it is never rendered as DOM text, logged, or stored. */}
      <div className="dashboard-auth-qr" role="img" aria-label="Authenticator setup QR code" data-testid="dashboard-auth-qr">
        {provisioningUri ? (
          <QRCodeSVG value={provisioningUri} size={188} level="M" title="Authenticator setup QR code" />
        ) : null}
      </div>
      <p className="dashboard-auth-help">
        Open Microsoft Authenticator, Google Authenticator, Authy, or another TOTP app and scan this QR code.
      </p>

      {showSetupKey ? (
        <div className="dashboard-auth-setup-key">
          <span className="dashboard-auth-copy-label">Setup key</span>
          <code
            className="dashboard-auth-code"
            data-testid="dashboard-auth-totp-secret"
            tabIndex={0}
            aria-label="Authenticator setup key"
          >
            {totpSecret}
          </code>
          <div className="dashboard-auth-actions">
            <button
              type="button"
              className="dashboard-auth-button dashboard-auth-button--ghost"
              onClick={copyKey}
              data-testid="dashboard-auth-copy-key"
            >
              {copied ? <IconCheck size={16} /> : null}
              {copied ? "Copied" : "Copy setup key"}
            </button>
          </div>
          <span className="dashboard-auth-copy-status" role="status" aria-live="polite">
            {copied ? "Setup key copied to clipboard." : ""}
          </span>
          <p className="dashboard-auth-warning">
            <IconWarning size={14} />
            Never share this key. Anyone who has it can generate your sign-in codes.
          </p>
        </div>
      ) : (
        <button
          type="button"
          className="dashboard-auth-link-button"
          onClick={() => setShowSetupKey(true)}
          data-testid="dashboard-auth-show-setup-key"
        >
          Can&apos;t scan? Show setup key
        </button>
      )}

      <label className="dashboard-auth-field">
        <span>Authenticator code</span>
        <input
          data-testid="dashboard-auth-setup-code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={setupCode}
          onChange={onCodeChange}
          placeholder="123456"
          maxLength={6}
          required
        />
      </label>
      <div className="dashboard-auth-actions">
        <button type="button" className="dashboard-auth-button dashboard-auth-button--ghost" onClick={onReset} disabled={busy}>
          <IconRefresh size={16} />
          Start over
        </button>
        <button type="submit" className="dashboard-auth-button" disabled={busy}>
          {busy ? "Saving..." : "Complete setup"}
          {!busy ? <IconCheck size={16} /> : null}
        </button>
      </div>
    </form>
  );
}

export function DashboardAuthClient() {
  const router = useRouter();
  const busyRef = useRef(false);
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [otpId, setOtpId] = useState("");
  const [challenge, setChallenge] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [provisioningUri, setProvisioningUri] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const steps = useMemo(
    () => [
      { key: "email", label: "Email", icon: <IconMail size={14} /> },
      { key: "otp", label: "OTP", icon: <IconArrowRight size={14} /> },
      { key: "setup", label: "Authenticator setup", icon: <IconCheck size={14} /> },
      { key: "login", label: "Authenticator login", icon: <IconCheck size={14} /> },
    ],
    [],
  );

  const activeStepIndex = step === "email" ? 0 : step === "otp" ? 1 : step === "setup" ? 2 : 3;

  function resetFlow() {
    busyRef.current = false;
    setBusy(false);
    setStep("email");
    setEmail("");
    setOtp("");
    setSetupCode("");
    setLoginCode("");
    setOtpId("");
    setChallenge("");
    setTotpSecret("");
    setProvisioningUri("");
    setError("");
  }

  function beginSubmission(): boolean {
    if (busyRef.current) {
      return false;
    }

    busyRef.current = true;
    setBusy(true);
    setError("");
    return true;
  }

  function endSubmission(): void {
    busyRef.current = false;
    setBusy(false);
  }

  function clearSensitiveState(): void {
    setOtp("");
    setSetupCode("");
    setLoginCode("");
    setOtpId("");
    setChallenge("");
    setTotpSecret("");
    setProvisioningUri("");
  }

  async function handleRequestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError(GENERIC_FAILURE);
      return;
    }

    if (!beginSubmission()) return;

    try {
      const result = await postJson<RequestOtpResponse>("/api/dashboard/auth/request-otp", {
        email: trimmedEmail,
      });

      const requestData = result.data;
      if (!result.ok || !requestData || !requestData.ok) {
        setError(GENERIC_FAILURE);
        return;
      }

      setOtpId(requestData.otpId);
      setOtp("");
      setSetupCode("");
      setLoginCode("");
      setChallenge("");
      setTotpSecret("");
      setProvisioningUri("");
      setStep("otp");
    } finally {
      endSubmission();
    }
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedOtp = sanitizeNumeric(otp, 6);
    if (trimmedOtp.length !== 6 || !otpId) {
      setError(GENERIC_FAILURE);
      return;
    }

    if (!beginSubmission()) return;

    try {
      const result = await postJson<VerifyOtpResponse>("/api/dashboard/auth/verify-otp", {
        otpId,
        rawOtp: trimmedOtp,
      });

      const verifyData = result.data;
      if (!result.ok || !verifyData || !verifyData.ok) {
        setError(GENERIC_FAILURE);
        return;
      }

      setOtp("");
      setSetupCode("");
      setLoginCode("");
      setError("");

      if (verifyData.stage === "totp_setup_required") {
        setChallenge(verifyData.challenge);
        setTotpSecret(verifyData.totpSecret);
        setProvisioningUri(verifyData.provisioningUri);
        setStep("setup");
        return;
      }

      setChallenge(verifyData.challenge);
      setStep("login");
    } finally {
      endSubmission();
    }
  }

  async function handleCompleteSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCode = sanitizeNumeric(setupCode, 6);
    if (trimmedCode.length !== 6 || !challenge) {
      setError(GENERIC_FAILURE);
      return;
    }

    if (!beginSubmission()) return;

    try {
      const result = await postJson<GenericOkResponse>("/api/dashboard/auth/complete-totp-setup", {
        challenge,
        code: trimmedCode,
      });

      const setupData = result.data;
      if (!result.ok || !setupData || !setupData.ok) {
        setError(GENERIC_FAILURE);
        return;
      }

      clearSensitiveState();
      router.replace("/overview");
      router.refresh();
    } finally {
      endSubmission();
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCode = sanitizeNumeric(loginCode, 6);
    if (trimmedCode.length !== 6 || !challenge) {
      setError(GENERIC_FAILURE);
      return;
    }

    if (!beginSubmission()) return;

    try {
      const result = await postJson<GenericOkResponse>("/api/dashboard/auth/verify-totp", {
        challenge,
        code: trimmedCode,
      });

      const loginData = result.data;
      if (!result.ok || !loginData || !loginData.ok) {
        setError(GENERIC_FAILURE);
        return;
      }

      clearSensitiveState();
      router.replace("/overview");
      router.refresh();
    } finally {
      endSubmission();
    }
  }

  return (
    <main className="dashboard-auth-shell" data-testid="dashboard-auth-shell" data-step={step}>
      <div className="dashboard-auth-panel">
        <header className="dashboard-auth-header">
          <div className="dashboard-auth-brand">
            <span className="dashboard-auth-brand__mark">
              <IconMail size={18} />
            </span>
            <div>
              <div className="dashboard-auth-kicker">ApplyWizz Dashboard</div>
              <h1 className="dashboard-auth-title">Sign in</h1>
            </div>
          </div>
          <p className="dashboard-auth-subtitle">Approved staff only.</p>
        </header>

        <section className="dashboard-auth-steps" aria-label="Authentication steps">
          {steps.map((item, index) => (
            <StepChip
              key={item.key}
              label={item.label}
              icon={item.icon}
              active={activeStepIndex === index}
              done={activeStepIndex > index}
            />
          ))}
        </section>

        {error ? (
          <div className="dashboard-auth-error" role="alert" data-testid="dashboard-auth-error">
            <IconWarning size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        {step === "email" ? (
          <form className="dashboard-auth-form" onSubmit={handleRequestOtp}>
            <label className="dashboard-auth-field">
              <span>Email</span>
              <input
                data-testid="dashboard-auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@applywizz.ai"
                maxLength={254}
                required
              />
            </label>
            <button type="submit" className="dashboard-auth-button" disabled={busy}>
              {busy ? "Sending..." : "Send OTP"}
              {!busy ? <IconArrowRight size={16} /> : null}
            </button>
          </form>
        ) : null}

        {step === "otp" ? (
          <form className="dashboard-auth-form" onSubmit={handleVerifyOtp}>
            <h2 className="dashboard-auth-step-heading">Verify the email code</h2>
            <label className="dashboard-auth-field">
              <span>6-digit OTP</span>
              <input
                data-testid="dashboard-auth-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(event) => setOtp(sanitizeNumeric(event.target.value, 6))}
                placeholder="123456"
                maxLength={6}
                required
              />
            </label>
            <div className="dashboard-auth-actions">
              <button type="button" className="dashboard-auth-button dashboard-auth-button--ghost" onClick={resetFlow} disabled={busy}>
                <IconRefresh size={16} />
                Use another email
              </button>
              <button type="submit" className="dashboard-auth-button" disabled={busy}>
                {busy ? "Checking..." : "Continue"}
                {!busy ? <IconArrowRight size={16} /> : null}
              </button>
            </div>
          </form>
        ) : null}

        {step === "setup" ? (
          <AuthenticatorSetup
            provisioningUri={provisioningUri}
            totpSecret={totpSecret}
            setupCode={setupCode}
            busy={busy}
            onCodeChange={(event) => setSetupCode(sanitizeNumeric(event.target.value, 6))}
            onSubmit={handleCompleteSetup}
            onReset={resetFlow}
          />
        ) : null}

        {step === "login" ? (
          <form className="dashboard-auth-form" onSubmit={handleLogin}>
            <h2 className="dashboard-auth-step-heading">Enter your authenticator code</h2>
            <label className="dashboard-auth-field">
              <span>6-digit code</span>
              <input
                data-testid="dashboard-auth-login-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={loginCode}
                onChange={(event) => setLoginCode(sanitizeNumeric(event.target.value, 6))}
                placeholder="123456"
                maxLength={6}
                required
              />
            </label>
            <div className="dashboard-auth-actions">
              <button type="button" className="dashboard-auth-button dashboard-auth-button--ghost" onClick={resetFlow} disabled={busy}>
                <IconRefresh size={16} />
                Use another email
              </button>
              <button type="submit" className="dashboard-auth-button" disabled={busy}>
                {busy ? "Signing in..." : "Sign in"}
                {!busy ? <IconArrowRight size={16} /> : null}
              </button>
            </div>
          </form>
        ) : null}
      </div>

      <style>{`
        .dashboard-auth-shell {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background:
            radial-gradient(circle at 20% 20%, rgba(108, 99, 255, 0.12), transparent 30%),
            radial-gradient(circle at 80% 80%, rgba(167, 139, 250, 0.12), transparent 28%),
            var(--color-bg);
          color: var(--color-text-primary);
        }
        .dashboard-auth-panel {
          width: min(100%, 760px);
          border: 1px solid var(--color-border);
          border-radius: 20px;
          background: rgba(15, 17, 23, 0.88);
          backdrop-filter: blur(18px);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
          padding: 28px;
        }
        .dashboard-auth-header {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 20px;
        }
        .dashboard-auth-brand {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .dashboard-auth-brand__mark {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: rgba(108, 99, 255, 0.14);
          border: 1px solid rgba(108, 99, 255, 0.24);
          color: #d7d4ff;
          flex: 0 0 auto;
        }
        .dashboard-auth-kicker {
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--color-text-muted);
        }
        .dashboard-auth-title {
          font-family: var(--font-display);
          font-size: clamp(2rem, 4vw, 2.8rem);
          line-height: 1.08;
          margin-top: 2px;
        }
        .dashboard-auth-subtitle {
          color: var(--color-text-secondary);
          font-size: 0.98rem;
        }
        .dashboard-auth-steps {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin: 24px 0;
        }
        .dashboard-auth-step {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid var(--color-border);
          background: rgba(255, 255, 255, 0.02);
          color: var(--color-text-secondary);
        }
        .dashboard-auth-step.active {
          border-color: rgba(108, 99, 255, 0.45);
          background: rgba(108, 99, 255, 0.12);
          color: var(--color-text-primary);
        }
        .dashboard-auth-step.done {
          border-color: rgba(110, 231, 183, 0.28);
          background: rgba(110, 231, 183, 0.08);
          color: var(--color-text-primary);
        }
        .dashboard-auth-step__icon,
        .dashboard-auth-step__check {
          display: inline-flex;
          flex: 0 0 auto;
        }
        .dashboard-auth-step__label {
          min-width: 0;
          font-size: 0.9rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .dashboard-auth-error {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid rgba(248, 113, 113, 0.24);
          background: rgba(248, 113, 113, 0.08);
          color: #fecaca;
        }
        .dashboard-auth-form {
          display: grid;
          gap: 16px;
        }
        .dashboard-auth-step-heading {
          font-size: 1.05rem;
          font-weight: 600;
          color: var(--color-text-primary);
        }
        .dashboard-auth-field {
          display: grid;
          gap: 8px;
        }
        .dashboard-auth-field span,
        .dashboard-auth-copy-label {
          font-size: 0.9rem;
          color: var(--color-text-secondary);
        }
        .dashboard-auth-field input {
          width: 100%;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(21, 24, 32, 0.9);
          color: var(--color-text-primary);
          padding: 14px 14px;
          outline: none;
          font-size: 1rem;
        }
        .dashboard-auth-field input:focus {
          border-color: rgba(108, 99, 255, 0.6);
          box-shadow: 0 0 0 3px rgba(108, 99, 255, 0.16);
        }
        .dashboard-auth-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          justify-content: space-between;
        }
        .dashboard-auth-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 1px solid rgba(108, 99, 255, 0.28);
          border-radius: 12px;
          background: linear-gradient(135deg, rgba(108, 99, 255, 0.95), rgba(167, 139, 250, 0.85));
          color: #f8f7ff;
          padding: 12px 16px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
        }
        .dashboard-auth-button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 24px rgba(108, 99, 255, 0.24);
        }
        .dashboard-auth-button:disabled {
          cursor: not-allowed;
          opacity: 0.72;
        }
        .dashboard-auth-button--ghost {
          background: rgba(255, 255, 255, 0.03);
          color: var(--color-text-primary);
        }
        .dashboard-auth-copy-block {
          display: grid;
          gap: 6px;
        }
        .dashboard-auth-code {
          display: block;
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid var(--color-border);
          background: rgba(255, 255, 255, 0.03);
          color: #d8dfff;
          font-size: 0.88rem;
          overflow-wrap: anywhere;
          word-break: break-word;
          letter-spacing: 0.04em;
        }
        .dashboard-auth-code:focus-visible {
          outline: none;
          border-color: rgba(108, 99, 255, 0.6);
          box-shadow: 0 0 0 3px rgba(108, 99, 255, 0.16);
        }
        .dashboard-auth-qr {
          display: grid;
          place-items: center;
          padding: 16px;
          border-radius: 16px;
          border: 1px solid var(--color-border);
          background: #ffffff;
          width: fit-content;
          margin: 0 auto;
        }
        .dashboard-auth-help {
          text-align: center;
          font-size: 0.92rem;
          color: var(--color-text-secondary);
        }
        .dashboard-auth-link-button {
          justify-self: center;
          background: none;
          border: none;
          padding: 4px 6px;
          color: #c7c3ff;
          font-size: 0.9rem;
          text-decoration: underline;
          cursor: pointer;
          border-radius: 8px;
        }
        .dashboard-auth-link-button:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px rgba(108, 99, 255, 0.24);
        }
        .dashboard-auth-setup-key {
          display: grid;
          gap: 8px;
          padding: 14px;
          border-radius: 12px;
          border: 1px solid rgba(248, 191, 113, 0.24);
          background: rgba(248, 191, 113, 0.06);
        }
        .dashboard-auth-copy-status {
          font-size: 0.82rem;
          color: #86efac;
          min-height: 1em;
        }
        .dashboard-auth-warning {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.82rem;
          color: #fcd8a8;
        }
        @media (max-width: 720px) {
          .dashboard-auth-panel {
            padding: 20px;
          }
          .dashboard-auth-steps {
            grid-template-columns: 1fr 1fr;
          }
          .dashboard-auth-actions {
            flex-direction: column;
          }
          .dashboard-auth-button {
            width: 100%;
          }
        }
      `}</style>
    </main>
  );
}
