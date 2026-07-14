type QueryError = { message: string };
type QueryResult<T> = Promise<{ data: T; error: QueryError | null }>;
type SelectChain<T = unknown> = {
  eq: (column: string, value: unknown) => SelectChain<T>;
  in: (column: string, values: string[]) => QueryResult<T[]>;
  maybeSingle: () => QueryResult<T | null>;
};
type SupabaseTable = {
  select: (columns: string) => SelectChain;
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: unknown) => Promise<{ error: QueryError | null }>;
  };
  upsert: (
    rows: Record<string, unknown>[],
    options?: Record<string, unknown>,
  ) => Promise<{ error: QueryError | null }>;
};
type SupabaseClient = {
  from: (table: string) => SupabaseTable;
};

type BackfillMessage = {
  messageId: string;
  sender?: string;
  fromAddress?: string;
  subject?: string;
  receivedTime: string | number;
  folderName?: string;
  folderId?: string;
  hasAttachment?: string | number;
};

type BackfillConnection = {
  id: string;
  zoho_account_id: string;
  email_address: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
};

type BackfillCheckpoint = {
  mailbox_email: string;
  next_start: number;
};

type ExistingMetadata = {
  message_id: string;
};

type ZohoResponse<T> = {
  status?: {
    code?: number;
    description?: string;
  };
  data?: T;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
};

export type BackfillDeps = {
  supabase: SupabaseClient;
  fetchImpl: (url: string, init?: Record<string, unknown>) => Promise<FetchResponse>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  log: (message: string) => void;
  shouldStop: () => boolean;
};

export type BackfillOptions = {
  pageSize: number;
  maxPages: number;
  dryRun: boolean;
  startOffset: number;
  confirmProductionBackfill?: boolean;
  delayMs?: number;
  mailbox?: string;
  clientId?: string;
  clientSecret?: string;
  accountsBaseUrl?: string;
  mailBaseUrl?: string;
};

export type BackfillResult = {
  fetched: number;
  inserted: number;
  updated: number;
  wouldInsert: number;
  wouldUpdate: number;
  pages: number;
  nextStart: number;
  dryRun: boolean;
  stopped: boolean;
  hasMore: boolean;
};

const DEFAULT_DELAY_MS = 1000;
const MAX_RATE_LIMIT_RETRIES = 3;
const BACKFILL_HOLDING_STATUS = "historical_ingested";

export type BackfillErrorCode =
  | "BACKFILL_ZOHO_AUTH_FAILED"
  | "BACKFILL_ZOHO_FETCH_FAILED"
  | "BACKFILL_SUPABASE_FAILED"
  | "BACKFILL_RATE_LIMITED"
  | "BACKFILL_CONFIG_INVALID"
  | "BACKFILL_UNKNOWN_ERROR";

export function toBackfillErrorCode(error: unknown): BackfillErrorCode {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("configuration") ||
    message.includes("ZOHO_MAIL_BASE_URL") ||
    message.includes("ZOHO_SYNC_MAILBOX") ||
    message.includes("--confirm-production-backfill")
  ) {
    return "BACKFILL_CONFIG_INVALID";
  }
  if (message.includes("token refresh")) return "BACKFILL_ZOHO_AUTH_FAILED";
  if (message.includes("rate limit")) return "BACKFILL_RATE_LIMITED";
  if (message.includes("Zoho backfill messages request failed")) return "BACKFILL_ZOHO_FETCH_FAILED";
  if (
    message.includes("zoho_connections") ||
    message.includes("metadata") ||
    message.includes("checkpoint")
  ) {
    return "BACKFILL_SUPABASE_FAILED";
  }
  return "BACKFILL_UNKNOWN_ERROR";
}

function clampInt(value: number, fallback: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function optionsFromEnv(args: string[], env = process.env): BackfillOptions {
  const dryRunEnv = env.BACKFILL_DRY_RUN;
  const dryRun =
    !args.includes("--confirm-production-backfill") &&
    dryRunEnv?.toLowerCase() !== "false";

  return {
    pageSize: clampInt(parseInt(env.BACKFILL_PAGE_SIZE ?? "25", 10), 25, 1, 100),
    maxPages: clampInt(parseInt(env.BACKFILL_MAX_PAGES ?? "1", 10), 1, 1, 100),
    dryRun,
    startOffset: clampInt(parseInt(env.BACKFILL_START_OFFSET ?? "0", 10), 0, 0, 1_000_000),
    confirmProductionBackfill: args.includes("--confirm-production-backfill"),
    mailbox: env.ZOHO_SYNC_MAILBOX?.toLowerCase().trim(),
    clientId: env.ZOHO_CLIENT_ID,
    clientSecret: env.ZOHO_CLIENT_SECRET,
    accountsBaseUrl: env.ZOHO_ACCOUNTS_BASE_URL,
    mailBaseUrl: env.ZOHO_MAIL_BASE_URL,
  };
}

async function refreshToken(
  connection: BackfillConnection,
  options: BackfillOptions,
  deps: BackfillDeps,
) {
  if (!options.clientId || !options.clientSecret || !options.accountsBaseUrl) {
    throw new Error("Zoho API configuration is incomplete on the server.");
  }

  const tokenResponse = await deps.fetchImpl(`${options.accountsBaseUrl}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: options.clientId,
      client_secret: options.clientSecret,
      refresh_token: connection.refresh_token,
    }).toString(),
  });
  const parsed = (await tokenResponse.json()) as Record<string, unknown>;
  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
  const expiresIn = Number(parsed.expires_in);

  if (!tokenResponse.ok || !accessToken || !Number.isFinite(expiresIn)) {
    throw new Error(`Zoho token refresh failed: ${String(parsed.error ?? tokenResponse.status)}`);
  }

  const refreshTime = deps.now();
  await deps.supabase
    .from("zoho_connections")
    .update({
      access_token: accessToken,
      access_token_expires_at: new Date(refreshTime.getTime() + expiresIn * 1000).toISOString(),
      last_refresh_at: refreshTime.toISOString(),
      updated_at: refreshTime.toISOString(),
    })
    .eq("zoho_account_id", connection.zoho_account_id);

  return accessToken;
}

function receivedAt(item: BackfillMessage, fallbackIso: string) {
  const time = Number(item.receivedTime);
  return Number.isFinite(time) ? new Date(time).toISOString() : fallbackIso;
}

async function fetchPage(
  url: string,
  accessToken: string,
  deps: BackfillDeps,
): Promise<BackfillMessage[]> {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const response = await deps.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await deps.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_DELAY_MS);
      continue;
    }

    const parsed = (await response.json()) as ZohoResponse<BackfillMessage[]>;
    if (!response.ok || parsed.status?.code !== 200) {
      throw new Error(
        `Zoho backfill messages request failed: ${response.status} / ${parsed.status?.description ?? "unknown"}`,
      );
    }

    return Array.isArray(parsed.data) ? parsed.data : [];
  }

  throw new Error("Zoho backfill rate limit retries exhausted.");
}

export async function runZohoHistoryBackfill(
  rawOptions: BackfillOptions,
  deps: BackfillDeps,
): Promise<BackfillResult> {
  const options = {
    ...rawOptions,
    pageSize: clampInt(rawOptions.pageSize, 25, 1, 100),
    maxPages: clampInt(rawOptions.maxPages, 1, 1, 100),
    startOffset: clampInt(rawOptions.startOffset, 0, 0, 1_000_000),
    delayMs: rawOptions.delayMs ?? DEFAULT_DELAY_MS,
  };

  if (!options.dryRun && !options.confirmProductionBackfill) {
    throw new Error("Real ingestion requires --confirm-production-backfill.");
  }
  if (!options.mailBaseUrl) throw new Error("ZOHO_MAIL_BASE_URL is required.");
  if (!options.mailbox) throw new Error("ZOHO_SYNC_MAILBOX is required.");

  const { data: connection, error: connectionError } = await deps.supabase
    .from("zoho_connections")
    .select("*")
    .eq("status", "active")
    .eq("email_address", options.mailbox)
    .maybeSingle();

  if (connectionError) throw new Error(`Failed to query zoho_connections: ${connectionError.message}`);
  if (!connection) throw new Error("No active Zoho connection found for configured sync mailbox.");

  const typedConnection = connection as BackfillConnection;
  let accessToken = typedConnection.access_token;
  if (new Date(typedConnection.access_token_expires_at).getTime() < deps.now().getTime() + 300_000) {
    accessToken = await refreshToken(typedConnection, options, deps);
  }

  const { data: checkpoint, error: checkpointError } = await deps.supabase
    .from("zoho_backfill_checkpoints")
    .select("mailbox_email,next_start")
    .eq("mailbox_email", typedConnection.email_address)
    .maybeSingle();

  if (checkpointError) throw new Error(`Failed to query backfill checkpoint: ${checkpointError.message}`);

  const typedCheckpoint = checkpoint as BackfillCheckpoint | null;
  let nextStart = Number(typedCheckpoint?.next_start ?? options.startOffset);
  if (!Number.isFinite(nextStart) || nextStart < 0) nextStart = options.startOffset;

  const result: BackfillResult = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    wouldInsert: 0,
    wouldUpdate: 0,
    pages: 0,
    nextStart,
    dryRun: options.dryRun,
    stopped: false,
    hasMore: false,
  };

  deps.log(
    `[Zoho Backfill] start dry_run=${options.dryRun} page_size=${options.pageSize} max_pages=${options.maxPages} start=${nextStart}`,
  );

  while (result.pages < options.maxPages) {
    if (deps.shouldStop()) {
      result.stopped = true;
      break;
    }

    const url = `${options.mailBaseUrl}/accounts/${typedConnection.zoho_account_id}/messages/view?limit=${options.pageSize}&start=${nextStart}`;
    const page = await fetchPage(url, accessToken, deps);
    if (page.length === 0) break;

    const ids = page.map((item) => item.messageId);
    const { data: existingRecords, error: existingError } = await deps.supabase
      .from("zoho_email_metadata")
      .select("message_id")
      .eq("mailbox_email", typedConnection.email_address)
      .in("message_id", ids);

    if (existingError) throw new Error(`Failed to query existing metadata: ${existingError.message}`);

    const existingRows = (existingRecords ?? []) as ExistingMetadata[];
    const existing = new Set(existingRows.map((row) => row.message_id));
    const nowIso = deps.now().toISOString();
    const rows = page.map((item) => {
      const duplicate = existing.has(item.messageId);
      if (options.dryRun) {
        if (duplicate) result.wouldUpdate++;
        else result.wouldInsert++;
      } else if (duplicate) {
        result.updated++;
      } else {
        result.inserted++;
      }

      const hasAttachments =
        item.hasAttachment === "1" ||
        item.hasAttachment === 1 ||
        Boolean(Number(item.hasAttachment));

      return {
        zoho_connection_id: typedConnection.id,
        mailbox_email: typedConnection.email_address,
        message_id: item.messageId,
        sender: item.sender || item.fromAddress || "unknown",
        subject: item.subject || "(No Subject)",
        received_at: receivedAt(item, nowIso),
        folder_id: item.folderId || "unknown",
        folder_name: item.folderName || "Inbox",
        has_attachments: hasAttachments,
        attachment_count: hasAttachments ? 1 : 0,
        sync_status: "synced",
        classification_status: BACKFILL_HOLDING_STATUS,
        last_seen_at: nowIso,
        updated_at: nowIso,
      };
    });

    if (!options.dryRun) {
      const newRows = rows.filter((row) => !existing.has(row.message_id));
      if (newRows.length > 0) {
        const { error: upsertError } = await deps.supabase
          .from("zoho_email_metadata")
          .upsert(newRows, { onConflict: "mailbox_email,message_id" });
        if (upsertError) throw new Error(`Failed to upsert email metadata: ${upsertError.message}`);
      }
    }

    result.fetched += page.length;
    result.pages++;
    nextStart += page.length;
    result.nextStart = nextStart;
    result.hasMore = page.length === options.pageSize;

    if (!options.dryRun) {
      const last = page[page.length - 1];
      const { error: checkpointUpsertError } = await deps.supabase
        .from("zoho_backfill_checkpoints")
        .upsert(
          [
            {
              mailbox_email: typedConnection.email_address,
              next_start: nextStart,
              pages_completed: result.pages,
              total_fetched: result.fetched,
              total_inserted: result.inserted,
              total_updated: result.updated,
              last_message_id: last.messageId,
              last_received_at: receivedAt(last, nowIso),
              status: "running",
              updated_at: nowIso,
            },
          ],
          { onConflict: "mailbox_email" },
        );
      if (checkpointUpsertError) {
        throw new Error(`Failed to persist backfill checkpoint: ${checkpointUpsertError.message}`);
      }
    }

    deps.log(
      `[Zoho Backfill] page=${result.pages} fetched=${result.fetched} inserted=${result.inserted} updated=${result.updated} would_insert=${result.wouldInsert} would_update=${result.wouldUpdate} next_start=${result.nextStart}`,
    );

    if (page.length < options.pageSize || deps.shouldStop()) {
      result.stopped = deps.shouldStop();
      break;
    }
    await deps.sleep(options.delayMs);
  }

  deps.log(
    `[Zoho Backfill] complete dry_run=${result.dryRun} pages=${result.pages} fetched=${result.fetched} inserted=${result.inserted} updated=${result.updated} would_insert=${result.wouldInsert} would_update=${result.wouldUpdate} next_start=${result.nextStart} stopped=${result.stopped}`,
  );

  return result;
}
