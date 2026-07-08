# Human Review + Safe Email Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live, redacted, never-stored email preview and three human review actions (confirm / change category / send to review) to the Interview detail page, with a full audit trail, and make every dashboard count use the human-corrected category first.

**Architecture:** Two small shared modules extracted from existing private logic (`lib/zoho/zohoApiHelpers.ts` for token-refresh/HTML-stripping, `lib/classify/redactionPatterns.ts` for the regex patterns already used to scrub AI reasons) avoid duplicating unsafe-content-handling logic across files. A new `lib/zoho/emailPreview.ts` fetches and redacts content on demand. A new `lib/zoho/reviewCorrection.ts` validates and persists a human decision. The detail page gains a Server Action (not a new API route) so the save action inherits the already-covered `/operations/:path*` middleware protection. `lib/zoho/cooWorkspace.ts` gains a single `effectiveCategory()` helper used everywhere it currently reads `row.category` directly, so dashboard counts reflect corrections automatically.

**Tech Stack:** Next.js App Router Server Actions, Supabase, TypeScript, Vitest.

## Global Constraints

- Never store raw or redacted email body anywhere in Supabase. `emailPreview.ts` returns text directly to the page; nothing is written to any table.
- Never render body content as HTML. Plain text only — no `dangerouslySetInnerHTML`.
- `category` (the AI's original classification) is never overwritten by any code path in this plan.
- The save action is a Server Action co-located in `/operations/interviews/[id]/page.tsx`, not a new `/api/*` route — `/api/*` is not covered by the Basic Auth middleware, and `/operations/:path*` already is.
- The save action must re-verify the row still matches the interview filter (`category = 'interview_invite' AND classification_status != 'dead_letter'` — or, after this plan, more precisely still exists and belongs to the mailbox) before writing. Never trust a client-submitted id blindly.
- No new logging of raw content, raw provider errors, or raw Supabase error messages anywhere in the new code.
- Do not touch `worker/index.ts`, `lib/zoho/syncEmails.ts`, `lib/worker-core/*`, `middleware.ts`, `lib/zoho/backfillZohoHistory.ts`, `lib/zoho/releaseHistoricalBatch.ts`, `zoho_sync_checkpoints`, `zoho_backfill_checkpoints`, or `zoho_release_batches`.
- No Hy3, DeepSeek, OpenRouter, Leads API, CA workflow, or Authenticator login code.
- No git push, no deploy, no `supabase db push`, no production action in this plan. Every task ends with a local commit only.

---

### Task 1: Migration — human correction columns

**Files:**
- Create: `supabase/migrations/202607080003_add_human_review_columns.sql`

**Interfaces:**
- Produces: `zoho_email_metadata.human_category text`, `.reviewed_by text`, `.reviewed_at timestamptz`, `.correction_reason text` (all nullable). Tasks 5, 6, 7 depend on these.

- [ ] **Step 1: Write the migration**

```sql
-- Phase: Human Review + Safe Email Preview. Preserves the AI's
-- original category (never overwritten) and adds a human-decision
-- overlay: human_category (null until a human acts), reviewed_by,
-- reviewed_at, and an optional correction_reason. Additive only.
alter table public.zoho_email_metadata
  add column human_category text,
  add column reviewed_by text,
  add column reviewed_at timestamptz,
  add column correction_reason text;
```

- [ ] **Step 2: Verify**

Run: `cat supabase/migrations/202607080003_add_human_review_columns.sql`
Expected: matches the additive, no-backfill, no-existing-column-touched pattern used by every prior migration in this project (compare against `202607080001_add_company_job_title_to_email_metadata.sql`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202607080003_add_human_review_columns.sql
git commit -m "Add human_category/reviewed_by/reviewed_at/correction_reason columns"
```

**Do not run `supabase db push`.** Applying this migration to production is a separate, later, explicit step.

---

### Task 2: Extract shared Zoho helpers (no duplicated token-refresh/HTML-stripping logic)

**Files:**
- Create: `lib/zoho/zohoApiHelpers.ts`
- Create: `lib/zoho/zohoApiHelpers.test.ts`
- Modify: `lib/zoho/classifyEmails.ts` (remove the private `refreshZohoToken` and `stripHtml`, import from the new module instead)

**Interfaces:**
- Produces (used by `classifyEmails.ts` today, and by Task 4's `emailPreview.ts`):
  ```typescript
  export interface ZohoConnectionForAuth {
    zoho_account_id: string;
    refresh_token: string;
  }

  export async function refreshZohoToken(
    connection: ZohoConnectionForAuth,
    clientId: string,
    clientSecret: string,
    accountsBaseUrl: string,
  ): Promise<string>

  export function stripHtml(html: string): string
  ```

- [ ] **Step 1: Write the failing tests**

Create `lib/zoho/zohoApiHelpers.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => ({
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}));

describe("stripHtml", () => {
  it("removes tags, style, and script blocks, collapsing whitespace", async () => {
    const { stripHtml } = await import("./zohoApiHelpers");
    const html = "<style>.x{color:red}</style><p>Hello   <b>World</b></p><script>evil()</script>";
    expect(stripHtml(html)).toBe("Hello World");
  });
});

describe("refreshZohoToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the new access token on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: "new-token", expires_in: 3600 }),
      }),
    );

    const { refreshZohoToken } = await import("./zohoApiHelpers");
    const token = await refreshZohoToken(
      { zoho_account_id: "acct-1", refresh_token: "ref" },
      "cid",
      "secret",
      "https://accounts.zoho.test",
    );

    expect(token).toBe("new-token");
  });

  it("throws without leaking raw provider response text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "invalid_client", status: 401 }),
      }),
    );

    const { refreshZohoToken } = await import("./zohoApiHelpers");
    await expect(
      refreshZohoToken({ zoho_account_id: "acct-1", refresh_token: "ref" }, "cid", "secret", "https://accounts.zoho.test"),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/zoho/zohoApiHelpers.test.ts`
Expected: FAIL — `Cannot find module './zohoApiHelpers'`.

- [ ] **Step 3: Write the implementation**

Create `lib/zoho/zohoApiHelpers.ts` (moved verbatim from `classifyEmails.ts` lines 114-121 and 130-193, generalized to not require a full connection record):

```typescript
import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";

export interface ZohoConnectionForAuth {
  zoho_account_id: string;
  refresh_token: string;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function refreshZohoToken(
  connection: ZohoConnectionForAuth,
  clientId: string,
  clientSecret: string,
  accountsBaseUrl: string,
): Promise<string> {
  const tokenResponse = await fetch(`${accountsBaseUrl}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
    }).toString(),
  });

  const parsed: unknown = await tokenResponse.json();

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid response format from Zoho token endpoint.");
  }

  const tokenData = parsed as Record<string, unknown>;

  if (!tokenResponse.ok || tokenData.error) {
    throw new Error(
      `Zoho token refresh failed: ${String(tokenData.error ?? tokenResponse.status)}`,
    );
  }

  const newAccessToken =
    typeof tokenData.access_token === "string" && tokenData.access_token
      ? tokenData.access_token
      : null;
  const expiresIn = Number(tokenData.expires_in);

  if (!newAccessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error("Zoho returned incomplete data during token refresh.");
  }

  const supabase = createSupabaseServiceRoleClient();
  const refreshTime = new Date();
  const newExpiresAt = new Date(refreshTime.getTime() + expiresIn * 1000);

  const { error: updateError } = await supabase
    .from("zoho_connections")
    .update({
      access_token: newAccessToken,
      access_token_expires_at: newExpiresAt.toISOString(),
      last_refresh_at: refreshTime.toISOString(),
      updated_at: refreshTime.toISOString(),
    })
    .eq("zoho_account_id", connection.zoho_account_id);

  if (updateError) {
    throw new Error("Failed to persist refreshed access token.");
  }

  return newAccessToken;
}
```

- [ ] **Step 4: Update `classifyEmails.ts` to import instead of defining its own copies**

In `lib/zoho/classifyEmails.ts`:
1. Delete the private `stripHtml` function (lines 114-121) and the private `refreshZohoToken` function (lines 130-193).
2. Add to the top import block: `import { refreshZohoToken, stripHtml } from "@/lib/zoho/zohoApiHelpers";`
3. Every existing call site (`refreshZohoToken(connection as Record<string, string>, cfg.clientId, ...)`) keeps working unchanged — `Record<string, string>` structurally satisfies `ZohoConnectionForAuth` since both required fields are present.

- [ ] **Step 5: Run tests to verify they pass, and confirm no regression**

Run: `npx vitest run lib/zoho/zohoApiHelpers.test.ts lib/zoho/classifyEmails.test.ts`
Expected: PASS — new tests pass, and every existing `classifyEmails.test.ts` test still passes unchanged (behavior is identical, only the code's location moved).

Run: `npx vitest run`
Expected: PASS, full suite.

- [ ] **Step 6: Commit**

```bash
git add lib/zoho/zohoApiHelpers.ts lib/zoho/zohoApiHelpers.test.ts lib/zoho/classifyEmails.ts
git commit -m "Extract Zoho token-refresh and HTML-stripping into a shared module"
```

---

### Task 3: Extract shared redaction patterns (no duplicated redaction logic)

**Files:**
- Create: `lib/classify/redactionPatterns.ts`
- Create: `lib/classify/redactionPatterns.test.ts`
- Modify: `lib/classify/sanitizeReason.ts` (import the patterns instead of defining them privately)

**Interfaces:**
- Produces (used by `sanitizeReason.ts` today, and by Task 4's `emailPreview.ts`):
  ```typescript
  export function redactSensitivePatterns(text: string): string
  ```
  Applies, in order: URL → `[redacted-url]`, email → `[redacted-email]`, OTP-shaped 4-8 digit code → `[redacted-code]`, 24+ char token → `[redacted-token]`, password/passcode marker → `[redacted-marker]`, secret/API-key/bearer/auth marker → `[redacted-marker]`, quoted strings (8+ chars) → `[redacted-quote]`. Does **not** truncate length and does **not** fall back to a generic message — that policy (used by reasons, not previews) stays in `sanitizeReason.ts` itself.

- [ ] **Step 1: Write the failing tests**

Create `lib/classify/redactionPatterns.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { redactSensitivePatterns } from "./redactionPatterns";

describe("redactSensitivePatterns", () => {
  it("redacts a URL", () => {
    expect(redactSensitivePatterns("Visit https://example.com/reset now")).toBe(
      "Visit [redacted-url] now",
    );
  });

  it("redacts an email address", () => {
    expect(redactSensitivePatterns("Contact test@example.com for help")).toBe(
      "Contact [redacted-email] for help",
    );
  });

  it("redacts a 6-digit OTP-shaped code", () => {
    expect(redactSensitivePatterns("Your code is 482910 today")).toBe(
      "Your code is [redacted-code] today",
    );
  });

  it("redacts a long token", () => {
    expect(redactSensitivePatterns("token: abcdefghijklmnopqrstuvwxABCDEF123456")).toBe(
      "token: [redacted-token]",
    );
  });

  it("redacts a password marker", () => {
    expect(redactSensitivePatterns("Your password has been reset")).toBe(
      "Your [redacted-marker] has been reset",
    );
  });

  it("redacts a secret/api-key marker", () => {
    expect(redactSensitivePatterns("Your api key is required")).toBe(
      "Your [redacted-marker] is required",
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSensitivePatterns("Thanks for applying to the Data Analyst role")).toBe(
      "Thanks for applying to the Data Analyst role",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/classify/redactionPatterns.test.ts`
Expected: FAIL — `Cannot find module './redactionPatterns'`.

- [ ] **Step 3: Write the implementation**

Create `lib/classify/redactionPatterns.ts` (patterns moved verbatim from `sanitizeReason.ts` lines 5-13, made exported and reusable):

```typescript
const URL_PATTERN = String.raw`https?:\/\/\S+|www\.\S+`;
const EMAIL_PATTERN = String.raw`[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`;
const OTP_CODE_PATTERN = String.raw`\b\d{4,8}\b`;
const TOKEN_VALUE_PATTERN = String.raw`\b[A-Za-z0-9_-]{24,}\b`;
const PASSWORD_MARKER_PATTERN = String.raw`\b(?:password|passcode)\b`;
const SECRET_MARKER_PATTERN = String.raw`\b(?:api[-_ ]?key|access token|refresh token|bearer|authorization|client_secret|secret(?: key)?|private key)\b`;
const DOUBLE_QUOTE_PATTERN = String.raw`"[^"\n]{8,}"`;
const SINGLE_QUOTE_PATTERN = String.raw`'[^'\n]{8,}'`;

const URL_RE = new RegExp(URL_PATTERN, "gi");
const EMAIL_RE = new RegExp(EMAIL_PATTERN, "gi");
const OTP_CODE_RE = new RegExp(OTP_CODE_PATTERN, "g");
const TOKEN_RE = new RegExp(TOKEN_VALUE_PATTERN, "g");
const PASSWORD_MARKER_RE = new RegExp(PASSWORD_MARKER_PATTERN, "gi");
const SECRET_MARKER_RE = new RegExp(SECRET_MARKER_PATTERN, "gi");
const DOUBLE_QUOTE_RE = new RegExp(DOUBLE_QUOTE_PATTERN, "g");
const SINGLE_QUOTE_RE = new RegExp(SINGLE_QUOTE_PATTERN, "g");

export function redactSensitivePatterns(text: string): string {
  return text
    .replace(URL_RE, "[redacted-url]")
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(OTP_CODE_RE, "[redacted-code]")
    .replace(TOKEN_RE, "[redacted-token]")
    .replace(PASSWORD_MARKER_RE, "[redacted-marker]")
    .replace(SECRET_MARKER_RE, "[redacted-marker]")
    .replace(DOUBLE_QUOTE_RE, "[redacted-quote]")
    .replace(SINGLE_QUOTE_RE, "[redacted-quote]");
}
```

- [ ] **Step 4: Update `sanitizeReason.ts` to import the shared patterns**

In `lib/classify/sanitizeReason.ts`, replace the private pattern/regex declarations (lines 5-21, i.e. everything from `const URL_PATTERN` through `const SINGLE_QUOTE_RE`) with:

```typescript
import { redactSensitivePatterns } from "./redactionPatterns";
```

And in the `sanitizeReason` function body, replace the chained `.replace(URL_RE, ...).replace(EMAIL_RE, ...)...` (lines 86-94) with a single call:

```typescript
  let safe = redactSensitivePatterns(trimmed);
```

Leave every other line of `sanitizeReason.ts` unchanged (the length cap, the `reasonMatchesUnsafePolicy` check, the generic fallback, `UNSAFE_REASON_SQL_PATTERN`, `UNSAFE_REASON_DETECTION_RE`, and all exports stay exactly as they are — only the redaction step itself is now delegated).

- [ ] **Step 5: Run tests to verify they pass, and confirm no regression**

Run: `npx vitest run lib/classify/redactionPatterns.test.ts`
Expected: PASS.

Run: `npx vitest run lib/classify/sanitizeReason.test.ts` (if this file exists — check with `ls lib/classify/sanitizeReason.test.ts`; if it doesn't exist, skip this specific command but still run the full suite next).

Run: `npx vitest run`
Expected: PASS, full suite — `sanitizeReason`'s existing callers (`classifyEmails.ts`) must behave identically.

- [ ] **Step 6: Commit**

```bash
git add lib/classify/redactionPatterns.ts lib/classify/redactionPatterns.test.ts lib/classify/sanitizeReason.ts
git commit -m "Extract shared redaction patterns from sanitizeReason"
```

---

### Task 4: Build `lib/zoho/emailPreview.ts`

**Files:**
- Create: `lib/zoho/emailPreview.ts`
- Create: `lib/zoho/emailPreview.test.ts`

**Interfaces:**
- Consumes: `refreshZohoToken`, `stripHtml` from Task 2; `redactSensitivePatterns` from Task 3; `createSupabaseServiceRoleClient` from `@/lib/supabase/serviceRole`.
- Produces (used by Task 8's page):
  ```typescript
  export const PREVIEW_MAX_LENGTH = 2000;

  export type GetSafeEmailPreviewResult =
    | { ok: true; preview: string }
    | { ok: false };

  export async function getSafeEmailPreview(emailRowId: string): Promise<GetSafeEmailPreviewResult>
  ```

- [ ] **Step 1: Write the failing tests**

Create `lib/zoho/emailPreview.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockRefreshZohoToken = vi.fn();

vi.mock("@/lib/zoho/zohoApiHelpers", () => ({
  refreshZohoToken: mockRefreshZohoToken,
  stripHtml: (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
}));

function makeSupabase(row: Record<string, unknown> | null) {
  return {
    from: (table: string) => {
      if (table === "zoho_email_metadata") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: row, error: null }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

let mockSupabase: ReturnType<typeof makeSupabase>;

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => mockSupabase,
}));

const ROW = {
  id: "row-1",
  message_id: "msg-1",
  folder_id: "fold-1",
  mailbox_email: "tracker@applywizard.ai",
};

describe("getSafeEmailPreview", () => {
  beforeEach(() => {
    mockSupabase = makeSupabase(ROW);
    mockRefreshZohoToken.mockReset();
    process.env.ZOHO_CLIENT_ID = "cid";
    process.env.ZOHO_CLIENT_SECRET = "secret";
    process.env.ZOHO_ACCOUNTS_BASE_URL = "https://accounts.zoho.test";
    process.env.ZOHO_MAIL_BASE_URL = "https://mail.zoho.test";
  });

  it("redacts a URL, email, OTP code, and token from the fetched content", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/content")) {
        return {
          ok: true,
          json: async () => ({
            status: { code: 200 },
            data: {
              content:
                "<p>Visit https://unsafe.test/reset or email test@example.com, code 482910</p>",
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    const originalFetch = global.fetch;
    global.fetch = fetchMock as typeof fetch;

    try {
      const { getSafeEmailPreview } = await import("./emailPreview");
      const result = await getSafeEmailPreview("row-1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.preview).not.toContain("unsafe.test");
        expect(result.preview).not.toContain("test@example.com");
        expect(result.preview).not.toContain("482910");
        expect(result.preview).toContain("[redacted-url]");
        expect(result.preview).toContain("[redacted-email]");
        expect(result.preview).toContain("[redacted-code]");
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("truncates a preview longer than the max length", async () => {
    const longContent = "A".repeat(3000);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: { code: 200 }, data: { content: longContent } }),
    }) as typeof fetch;

    const { getSafeEmailPreview, PREVIEW_MAX_LENGTH } = await import("./emailPreview");
    const result = await getSafeEmailPreview("row-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preview.length).toBeLessThanOrEqual(PREVIEW_MAX_LENGTH);
  });

  it("returns not-ok, never a raw error, when the Zoho fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ status: { code: 500, description: "internal error with secret token abc123def456" } }),
    }) as typeof fetch;

    const { getSafeEmailPreview } = await import("./emailPreview");
    const result = await getSafeEmailPreview("row-1");

    expect(result).toEqual({ ok: false });
  });

  it("returns not-ok when the row does not exist", async () => {
    mockSupabase = makeSupabase(null);

    const { getSafeEmailPreview } = await import("./emailPreview");
    const result = await getSafeEmailPreview("missing-id");

    expect(result).toEqual({ ok: false });
  });

  it("never includes subject, sender, or raw headers in its own source", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.resolve(__dirname, "emailPreview.ts"), "utf8");
    expect(src).not.toMatch(/\bsubject\b/i);
    expect(src).not.toMatch(/\bsender\b/i);
    expect(src).not.toMatch(/header/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/zoho/emailPreview.test.ts`
Expected: FAIL — `Cannot find module './emailPreview'`.

- [ ] **Step 3: Write the implementation**

Create `lib/zoho/emailPreview.ts`:

```typescript
import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { refreshZohoToken, stripHtml } from "@/lib/zoho/zohoApiHelpers";
import { redactSensitivePatterns } from "@/lib/classify/redactionPatterns";

export const PREVIEW_MAX_LENGTH = 2000;

export type GetSafeEmailPreviewResult = { ok: true; preview: string } | { ok: false };

interface PreviewRow {
  id: string;
  message_id: string;
  folder_id: string;
  mailbox_email: string;
}

export async function getSafeEmailPreview(emailRowId: string): Promise<GetSafeEmailPreviewResult> {
  try {
    const supabase = createSupabaseServiceRoleClient();

    const { data: row, error: rowError } = await supabase
      .from("zoho_email_metadata")
      .select("id, message_id, folder_id, mailbox_email")
      .eq("id", emailRowId)
      .maybeSingle();

    if (rowError || !row) return { ok: false };

    const typedRow = row as unknown as PreviewRow;

    const { data: connection, error: connError } = await supabase
      .from("zoho_connections")
      .select("zoho_account_id, refresh_token, access_token, access_token_expires_at")
      .eq("status", "active")
      .eq("email_address", typedRow.mailbox_email)
      .maybeSingle();

    if (connError || !connection) return { ok: false };

    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const accountsBaseUrl = process.env.ZOHO_ACCOUNTS_BASE_URL;
    const mailBaseUrl = process.env.ZOHO_MAIL_BASE_URL;

    if (!clientId || !clientSecret || !accountsBaseUrl || !mailBaseUrl) return { ok: false };

    let accessToken: string = (connection as { access_token: string }).access_token;
    const expiresAt = new Date(
      (connection as { access_token_expires_at: string }).access_token_expires_at,
    ).getTime();

    if (expiresAt < Date.now() + 5 * 60 * 1000) {
      accessToken = await refreshZohoToken(
        connection as { zoho_account_id: string; refresh_token: string },
        clientId,
        clientSecret,
        accountsBaseUrl,
      );
    }

    const zohoAccountId = (connection as { zoho_account_id: string }).zoho_account_id;
    const contentUrl = `${mailBaseUrl}/accounts/${zohoAccountId}/folders/${typedRow.folder_id}/messages/${typedRow.message_id}/content`;

    const contentRes = await fetch(contentUrl, {
      headers: { Accept: "application/json", Authorization: `Zoho-oauthtoken ${accessToken}` },
    });

    if (!contentRes.ok) return { ok: false };

    const payload = (await contentRes.json()) as { status?: { code: number }; data?: { content?: string } };

    if (payload.status?.code !== 200 || !payload.data) return { ok: false };

    const plainText = stripHtml(payload.data.content ?? "");
    const redacted = redactSensitivePatterns(plainText);
    const truncated = redacted.slice(0, PREVIEW_MAX_LENGTH);

    return { ok: true, preview: truncated };
  } catch {
    return { ok: false };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/zoho/emailPreview.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/zoho/emailPreview.ts lib/zoho/emailPreview.test.ts
git commit -m "Add on-demand redacted email preview, never stored"
```

---

### Task 5: Build `lib/zoho/reviewCorrection.ts`

**Files:**
- Create: `lib/zoho/reviewCorrection.ts`
- Create: `lib/zoho/reviewCorrection.test.ts`

**Interfaces:**
- Consumes: `createSupabaseServiceRoleClient`; `redactSensitivePatterns` from Task 3; the 13-value `EmailCategory` union from `@/lib/classify/types`.
- Produces (used by Task 8's Server Action):
  ```typescript
  export type ReviewDecision = "confirm" | "change_category" | "send_to_review";

  export interface SubmitReviewInput {
    id: string;
    decision: ReviewDecision;
    newCategory?: string;
    correctionReason?: string;
    reviewedBy: string;
  }

  export type SubmitReviewResult = { ok: true } | { ok: false; code: "INVALID_CATEGORY" | "ROW_NOT_FOUND" | "SUPABASE_FAILED" };

  export async function submitReviewDecision(input: SubmitReviewInput): Promise<SubmitReviewResult>
  ```

- [ ] **Step 1: Write the failing tests**

Create `lib/zoho/reviewCorrection.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

function makeSupabase(existingRow: Record<string, unknown> | null) {
  const update = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
  return {
    update,
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: existingRow, error: null }),
          }),
        }),
        update,
      }),
    },
  };
}

let mockSupabase: ReturnType<typeof makeSupabase>;

vi.mock("@/lib/supabase/serviceRole", () => ({
  createSupabaseServiceRoleClient: () => mockSupabase.client,
}));

const EXISTING_ROW = { id: "row-1", category: "interview_invite", classification_status: "classified" };

describe("submitReviewDecision", () => {
  beforeEach(() => {
    mockSupabase = makeSupabase(EXISTING_ROW);
  });

  it("confirm: sets human_category equal to the AI category and classification_status to classified", async () => {
    const { submitReviewDecision } = await import("./reviewCorrection");
    const result = await submitReviewDecision({
      id: "row-1",
      decision: "confirm",
      reviewedBy: "admin",
    });

    expect(result).toEqual({ ok: true });
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        human_category: "interview_invite",
        classification_status: "classified",
        reviewed_by: "admin",
      }),
    );
  });

  it("change_category: sets human_category to the picked value and validates it", async () => {
    const { submitReviewDecision } = await import("./reviewCorrection");
    const result = await submitReviewDecision({
      id: "row-1",
      decision: "change_category",
      newCategory: "recruiter_reply",
      reviewedBy: "admin",
    });

    expect(result).toEqual({ ok: true });
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ human_category: "recruiter_reply", classification_status: "classified" }),
    );
  });

  it("rejects an invalid category value without writing anything", async () => {
    const { submitReviewDecision } = await import("./reviewCorrection");
    const result = await submitReviewDecision({
      id: "row-1",
      decision: "change_category",
      newCategory: "not_a_real_category",
      reviewedBy: "admin",
    });

    expect(result).toEqual({ ok: false, code: "INVALID_CATEGORY" });
    expect(mockSupabase.update).not.toHaveBeenCalled();
  });

  it("send_to_review: sets classification_status to review, leaves human_category unset", async () => {
    const { submitReviewDecision } = await import("./reviewCorrection");
    const result = await submitReviewDecision({
      id: "row-1",
      decision: "send_to_review",
      reviewedBy: "admin",
    });

    expect(result).toEqual({ ok: true });
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ classification_status: "review" }),
    );
    expect(mockSupabase.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ human_category: expect.anything() }),
    );
  });

  it("redacts correction_reason the same way as an AI reason", async () => {
    const { submitReviewDecision } = await import("./reviewCorrection");
    await submitReviewDecision({
      id: "row-1",
      decision: "change_category",
      newCategory: "rejection",
      correctionReason: "Confirmed via https://internal.test/notes and code 998877",
      reviewedBy: "admin",
    });

    const call = mockSupabase.update.mock.calls[0][0] as Record<string, unknown>;
    expect(String(call.correction_reason)).not.toContain("internal.test");
    expect(String(call.correction_reason)).not.toContain("998877");
  });

  it("rejects when the row does not exist (anti-tampering)", async () => {
    mockSupabase = makeSupabase(null);

    const { submitReviewDecision } = await import("./reviewCorrection");
    const result = await submitReviewDecision({ id: "missing", decision: "confirm", reviewedBy: "admin" });

    expect(result).toEqual({ ok: false, code: "ROW_NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/zoho/reviewCorrection.test.ts`
Expected: FAIL — `Cannot find module './reviewCorrection'`.

- [ ] **Step 3: Write the implementation**

Create `lib/zoho/reviewCorrection.ts`:

```typescript
import { createSupabaseServiceRoleClient } from "@/lib/supabase/serviceRole";
import { redactSensitivePatterns } from "@/lib/classify/redactionPatterns";
import type { EmailCategory } from "@/lib/classify/types";

const VALID_CATEGORIES: readonly EmailCategory[] = [
  "application_received",
  "assessment",
  "interview_invite",
  "rejection",
  "job_offer",
  "recruiter_reply",
  "follow_up_needed",
  "otp_verification",
  "email_verification",
  "account_created",
  "system_notification",
  "spam_or_irrelevant",
  "unknown",
];

export type ReviewDecision = "confirm" | "change_category" | "send_to_review";

export interface SubmitReviewInput {
  id: string;
  decision: ReviewDecision;
  newCategory?: string;
  correctionReason?: string;
  reviewedBy: string;
}

export type SubmitReviewResult =
  | { ok: true }
  | { ok: false; code: "INVALID_CATEGORY" | "ROW_NOT_FOUND" | "SUPABASE_FAILED" };

export async function submitReviewDecision(input: SubmitReviewInput): Promise<SubmitReviewResult> {
  if (input.decision === "change_category") {
    if (!input.newCategory || !VALID_CATEGORIES.includes(input.newCategory as EmailCategory)) {
      return { ok: false, code: "INVALID_CATEGORY" };
    }
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data: row, error: rowError } = await supabase
    .from("zoho_email_metadata")
    .select("id, category, classification_status")
    .eq("id", input.id)
    .maybeSingle();

  if (rowError || !row) return { ok: false, code: "ROW_NOT_FOUND" };

  const typedRow = row as { id: string; category: string };
  const nowIso = new Date().toISOString();

  const payload: Record<string, unknown> = {
    reviewed_by: input.reviewedBy,
    reviewed_at: nowIso,
    updated_at: nowIso,
  };

  if (input.correctionReason) {
    payload.correction_reason = redactSensitivePatterns(input.correctionReason);
  }

  if (input.decision === "confirm") {
    payload.human_category = typedRow.category;
    payload.classification_status = "classified";
  } else if (input.decision === "change_category") {
    payload.human_category = input.newCategory;
    payload.classification_status = "classified";
  } else {
    payload.classification_status = "review";
  }

  const { error: updateError } = await supabase
    .from("zoho_email_metadata")
    .update(payload)
    .eq("id", input.id);

  if (updateError) return { ok: false, code: "SUPABASE_FAILED" };

  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/zoho/reviewCorrection.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/zoho/reviewCorrection.ts lib/zoho/reviewCorrection.test.ts
git commit -m "Add human review correction logic with category validation"
```

---

### Task 6: Extend `operationsTable.ts` for display

**Files:**
- Modify: `lib/zoho/operationsTable.ts`
- Modify: `lib/zoho/operationsTable.test.ts`

**Interfaces:**
- Produces: `InterviewRow` gains `human_category: string | null`, `reviewed_by: string | null`, `reviewed_at: string | null`, `correction_reason: string | null`. Used by Task 8's page.

- [ ] **Step 1: Write the failing test**

Add to `lib/zoho/operationsTable.test.ts`, inside the `describe("getInterviewById", ...)` block:

```typescript
  it("selects human review fields alongside the existing metadata fields", async () => {
    mockSupabase = createSupabaseMock([
      INTERVIEW_ROW({ id: "row-1", human_category: "recruiter_reply", reviewed_by: "admin", reviewed_at: "2026-07-08T00:00:00.000Z" }),
    ]);

    const { getInterviewById } = await import("./operationsTable");
    const result = await getInterviewById("row-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.human_category).toBe("recruiter_reply");
      expect(result.row.reviewed_by).toBe("admin");
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/zoho/operationsTable.test.ts`
Expected: FAIL — `result.row.human_category` is `undefined` (the column isn't selected yet).

- [ ] **Step 3: Update the implementation**

In `lib/zoho/operationsTable.ts`:
1. Add to `INTERVIEW_COLUMNS`: `"human_category", "reviewed_by", "reviewed_at", "correction_reason",`
2. Add to the `InterviewRow` interface:
   ```typescript
     human_category: string | null;
     reviewed_by: string | null;
     reviewed_at: string | null;
     correction_reason: string | null;
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/zoho/operationsTable.test.ts`
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Commit**

```bash
git add lib/zoho/operationsTable.ts lib/zoho/operationsTable.test.ts
git commit -m "Select human review fields in getInterviewById"
```

---

### Task 7: Make dashboard counts use the human-corrected category

**Files:**
- Modify: `lib/zoho/cooWorkspace.ts`
- Modify: `lib/zoho/cooWorkspace.test.ts`

**Interfaces:**
- Produces: `effectiveCategory(row)` — used at every existing category-comparison site in this file.

- [ ] **Step 1: Write the failing test**

Add to `lib/zoho/cooWorkspace.test.ts` (find the existing `describe` block that tests `getOverviewWorkspaceData`'s metrics, or add a new top-level `describe` if none fits):

```typescript
describe("effectiveCategory / human correction in dashboard counts", () => {
  it("counts a row under its human-corrected category, not the AI's original category", async () => {
    const emailRows = [
      {
        id: "row-1",
        original_recipient: "client@applywizard.ai",
        category: "interview_invite",
        human_category: "recruiter_reply",
        classification_status: "classified",
        confidence: 0.9,
        priority: "high",
        received_at: "2026-07-08T00:00:00.000Z",
        first_seen_at: "2026-07-08T00:00:00.000Z",
        created_at: "2026-07-08T00:00:00.000Z",
        classified_at: "2026-07-08T00:00:00.000Z",
        deadline: null,
        action_required: null,
        reason: null,
        next_retry_at: null,
        dead_lettered_at: null,
        claim_expires_at: null,
        last_error_code: null,
        routing_status: "routed",
        email_direction: "inbound",
      },
    ];

    const supabase = createSupabaseMock(emailRows, [
      { mailbox_email: "tracker@applywizard.ai", last_successful_sync_at: "2026-07-08T00:00:00.000Z" },
    ]);
    const { getOverviewWorkspaceData } = await import("./cooWorkspace");

    // getOverviewWorkspaceData takes the mock Supabase client as a direct
    // function argument (dependency injection), not via vi.mock — this is
    // the same convention every other test in this file already uses.
    const data = await getOverviewWorkspaceData({
      supabase: supabase as never,
      now: new Date("2026-07-08T12:00:00.000Z"),
      mailboxEmail: "tracker@applywizard.ai",
    });

    expect(data.metrics.interviews).toBe(0);
    expect(data.metrics.recruiterReplies).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/zoho/cooWorkspace.test.ts`
Expected: FAIL — `data.metrics.interviews` is `1` (still counting by raw `category`), not `0`.

- [ ] **Step 3: Add `human_category` to the column list and row type**

In `lib/zoho/cooWorkspace.ts`:
1. Add `"human_category"` to `SAFE_EMAIL_COLUMNS` (the array at the top of the file).
2. Add `human_category: string | null;` to the `EmailRow` interface.

- [ ] **Step 4: Add the `effectiveCategory` helper**

Add this function near `isBusinessCategory`/`isImportantCategory` (around line 368):

```typescript
function effectiveCategory(row: Pick<EmailRow, "category" | "human_category">): string | null {
  return row.human_category ?? row.category;
}
```

- [ ] **Step 5: Replace every usage site**

Replace every occurrence of the literal substring `row.category` in this file with `effectiveCategory(row)`, **except**:
- The `EmailRow` interface's own `category` field declaration (line ~95).
- The `SAFE_EMAIL_COLUMNS` array (references the column name as a string, not `row.category`).
- The `effectiveCategory` function's own body (which legitimately reads `row.category` and `row.human_category` directly — that's its job).

This affects these exact lines (verified present in the file before this task): 509, 510, 511, 512 (twice), 582, 583, 584, 585, 586, 587, 588, 599, 716 (twice), 756, 881, 890 (twice), 992, 993, 994, 995, 996, 997, 998, 1346, 1348, 1349, 1350, 1351, 1352, 1353, 1371, 1374, 1381 (twice), 1385, 1387 (twice). The transformation is identical and mechanical at every site — e.g. `row.category === "job_offer"` becomes `effectiveCategory(row) === "job_offer"`; `isBusinessCategory(row.category)` becomes `isBusinessCategory(effectiveCategory(row))`; `row.category && isBusinessCategory(row.category) ? row.category : null` becomes `effectiveCategory(row) && isBusinessCategory(effectiveCategory(row)) ? effectiveCategory(row) : null`.

- [ ] **Step 6: Verify completeness**

Run: `grep -n "row\.category" lib/zoho/cooWorkspace.ts`
Expected: matches **only** the `EmailRow` interface field declaration and the `effectiveCategory` function body — zero remaining usage sites outside those two places.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run lib/zoho/cooWorkspace.test.ts`
Expected: PASS, including the new human-correction test.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/zoho/cooWorkspace.ts lib/zoho/cooWorkspace.test.ts
git commit -m "Use human-corrected category in all dashboard counts"
```

---

### Task 8: Detail page UI — preview, review buttons, category picker, Server Action

**Files:**
- Modify: `app/(operations)/operations/interviews/[id]/page.tsx`

**Interfaces:**
- Consumes: `getSafeEmailPreview` from Task 4, `submitReviewDecision`/`ReviewDecision` from Task 5, the extended `InterviewRow` from Task 6.

- [ ] **Step 1: Add the Server Action and wire up the preview + buttons**

Modify `app/(operations)/operations/interviews/[id]/page.tsx`. Add these imports:

```typescript
import { getSafeEmailPreview } from "@/lib/zoho/emailPreview";
import { submitReviewDecision, type ReviewDecision } from "@/lib/zoho/reviewCorrection";
```

Add this Server Action, in the same file, above the page component:

```typescript
async function reviewAction(id: string, formData: FormData) {
  "use server";

  const decision = formData.get("decision") as ReviewDecision;
  const newCategory = formData.get("category")?.toString();
  const correctionReason = formData.get("correction_reason")?.toString();

  await submitReviewDecision({
    id,
    decision,
    newCategory: newCategory || undefined,
    correctionReason: correctionReason || undefined,
    reviewedBy: "admin",
  });

  revalidatePath(`/operations/interviews/${id}`);
}
```

Add `import { revalidatePath } from "next/cache";` to the top imports.

In the page component, after fetching `result` (the existing `getInterviewById` call), add:

```typescript
  const previewResult = await getSafeEmailPreview(id);
```

Add to the JSX, after the existing `<dl className="coo-detail-list">...</dl>` block:

```typescript
      <section className="coo-preview-section">
        <h2>Safe Email Preview</h2>
        <p className="coo-preview-text">
          {previewResult.ok ? previewResult.preview : "Preview unavailable."}
        </p>
      </section>

      <section className="coo-review-actions">
        <form action={reviewAction.bind(null, id)}>
          <input type="hidden" name="decision" value="confirm" />
          <button type="submit" className="coo-action-button">Yes, this is Interview</button>
        </form>

        <form action={reviewAction.bind(null, id)}>
          <input type="hidden" name="decision" value="change_category" />
          <label>
            <span>Change category to</span>
            <select name="category" defaultValue="">
              <option value="" disabled>Select category</option>
              <option value="application_received">Application Received</option>
              <option value="interview_invite">Interview Invite</option>
              <option value="assessment">Assessment</option>
              <option value="job_offer">Job Offer</option>
              <option value="rejection">Rejection</option>
              <option value="recruiter_reply">Recruiter Reply</option>
              <option value="follow_up_needed">Follow-up Needed</option>
              <option value="email_verification">Email Verification</option>
              <option value="otp_verification">OTP Verification</option>
              <option value="account_created">Account Created</option>
              <option value="system_notification">System Notification</option>
              <option value="spam_or_irrelevant">Spam / Irrelevant</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label>
            <span>Reason (optional)</span>
            <input type="text" name="correction_reason" />
          </label>
          <button type="submit" className="coo-action-button">No, change category</button>
        </form>

        <form action={reviewAction.bind(null, id)}>
          <input type="hidden" name="decision" value="send_to_review" />
          <button type="submit" className="coo-action-button">Send to Review</button>
        </form>
      </section>
```

Also add to the `<dl className="coo-detail-list">` block (after the existing "Status" entry):

```typescript
        <dt>Human category</dt>
        <dd>{row.human_category ?? "Not reviewed yet"}</dd>

        <dt>Reviewed by</dt>
        <dd>{row.reviewed_by ?? "Not reviewed yet"}</dd>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors attributable to this file (check against the known pre-existing error set from prior reviews before concluding anything is "preexisting").

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, sign in, open a real `interview_invite` row at `/operations/interviews/[id]`.
Expected: a "Safe Email Preview" section shows plain-text content (or "Preview unavailable"); three action forms are present; submitting "No, change category" with a picked value updates `Human category` and `Reviewed by` on the page after the redirect/revalidation.

- [ ] **Step 4: Commit**

```bash
git add "app/(operations)/operations/interviews/[id]/page.tsx"
git commit -m "Add safe email preview and human review actions to detail page"
```

---

### Task 9: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, zero failures, across every suite including all new ones from Tasks 2-7.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds; route table should show `/operations/interviews/[id]` unchanged in shape (still dynamic), no new routes added.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: the known pre-existing error set (`lib/classify/aiClassifier.test.ts`, `lib/zoho/backfillZohoHistory.test.ts`, `lib/zoho/classifyEmails.test.ts`, `lib/zoho/cooOverview.test.ts`, `tests/operations.spec.ts`, `.next/dev/types/validator.ts`) may still appear. Any error in a file this plan created or modified (`zohoApiHelpers.ts`, `redactionPatterns.ts`, `emailPreview.ts`, `reviewCorrection.ts`, `operationsTable.ts`, `cooWorkspace.ts`, the `[id]/page.tsx`) is new and must be fixed — do not wave it away as "preexisting" without checking against that known list first.

- [ ] **Step 5: Confirm no forbidden scope was touched**

Run: `git diff --stat <first-commit-of-this-plan>..HEAD -- worker/ lib/zoho/syncEmails.ts lib/worker-core/ middleware.ts lib/zoho/backfillZohoHistory.ts lib/zoho/releaseHistoricalBatch.ts`
Expected: empty output.

- [ ] **Step 6: Confirm no raw content leaks**

Run: `grep -rn "dangerouslySetInnerHTML" "app/(operations)/operations/interviews"`
Expected: no matches — preview is rendered as plain text only.

Run: `grep -n "error\.message\|String(error)" lib/zoho/emailPreview.ts lib/zoho/reviewCorrection.ts`
Expected: no matches.

- [ ] **Step 7: Confirm the AI's original category is never overwritten**

Run: `grep -n "category:" lib/zoho/reviewCorrection.ts`
Expected: `category` is only ever *read*, never assigned to, in this file — only `human_category` is written.

- [ ] **Step 8: Report status**

Confirm: no `supabase db push` run, nothing pushed to any remote, nothing deployed, no production action taken.
