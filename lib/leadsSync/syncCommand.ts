// syncCommand — pure argument parsing and environment guards for the
// sync:clients command (Live Monitor V1, Phase S2). No I/O, no secrets read
// beyond presence checks, nothing printed.

export type SyncMode = "dry-run" | "apply";

// Same allowlisted refs as lib/liveMonitor/testClient.ts.
export const PREVIEW_REF = "obirkjbzpykoehxacaaj";
export const PRODUCTION_REF = "nkkfsrhfttixwjbglhgg";

const ALLOWED_FLAGS = new Set(["--dry-run", "--apply", "--confirm-production"]);

export type ParseSyncArgsResult =
  | { ok: true; mode: SyncMode; confirmProduction: boolean }
  | { ok: false; code: "CONFLICTING_FLAGS" | "UNKNOWN_FLAG" };

export function parseSyncArgs(argv: string[]): ParseSyncArgsResult {
  const unknown = argv.find((arg) => !ALLOWED_FLAGS.has(arg));
  if (unknown) return { ok: false, code: "UNKNOWN_FLAG" };
  if (argv.includes("--dry-run") && argv.includes("--apply")) {
    return { ok: false, code: "CONFLICTING_FLAGS" };
  }

  return {
    ok: true,
    // Safe default: never write unless --apply was explicit.
    mode: argv.includes("--apply") ? "apply" : "dry-run",
    confirmProduction: argv.includes("--confirm-production"),
  };
}

export type SyncEnvironment = "preview" | "production";

export type SyncEnvGuardResult =
  | { ok: true; environment: SyncEnvironment; projectRef: string }
  | {
      ok: false;
      code:
        | "MISSING_LEADS_CREDENTIALS"
        | "MISSING_SERVICE_ROLE_KEY"
        | "MISSING_PROJECT_REF"
        | "SUPABASE_URL_UNRESOLVED"
        | "SUPABASE_URL_REF_MISMATCH"
        | "UNKNOWN_PROJECT_REF"
        | "PRODUCTION_APPLY_NOT_CONFIRMED";
    };

function resolveRef(url: string | undefined): string | null {
  if (!url?.trim()) return null;
  const match = url.trim().match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/);
  return match?.[1] ?? null;
}

/**
 * Every guard runs before any client is created or any request is made.
 * Only presence is checked — no secret value is ever returned or logged.
 */
export function resolveSyncEnvGuard(
  env: NodeJS.ProcessEnv,
  mode: SyncMode,
  confirmProduction: boolean,
): SyncEnvGuardResult {
  if (!env.LEADS_API_BASE_URL?.trim() || !env.LEADS_API_USERNAME?.trim() || !env.LEADS_API_PASSWORD?.trim()) {
    return { ok: false, code: "MISSING_LEADS_CREDENTIALS" };
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return { ok: false, code: "MISSING_SERVICE_ROLE_KEY" };

  const declaredRef = env.SUPABASE_PROJECT_REF?.trim();
  if (!declaredRef) return { ok: false, code: "MISSING_PROJECT_REF" };

  const resolvedRef = resolveRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!resolvedRef) return { ok: false, code: "SUPABASE_URL_UNRESOLVED" };
  if (resolvedRef !== declaredRef) return { ok: false, code: "SUPABASE_URL_REF_MISMATCH" };

  if (resolvedRef === PREVIEW_REF) return { ok: true, environment: "preview", projectRef: resolvedRef };

  if (resolvedRef === PRODUCTION_REF) {
    if (mode === "apply" && !confirmProduction) {
      return { ok: false, code: "PRODUCTION_APPLY_NOT_CONFIRMED" };
    }
    return { ok: true, environment: "production", projectRef: resolvedRef };
  }

  return { ok: false, code: "UNKNOWN_PROJECT_REF" };
}
