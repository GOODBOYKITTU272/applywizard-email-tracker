alter table public.zoho_email_metadata
  drop constraint if exists zoho_email_metadata_classification_status_check;

alter table public.zoho_email_metadata
  add column claimed_by text,
  add column claimed_at timestamptz,
  add column claim_expires_at timestamptz,
  add column attempt_count integer not null default 0,
  add column last_attempt_at timestamptz,
  add column next_retry_at timestamptz,
  add column last_error_code text,
  add column last_error_message_safe text,
  add column dead_lettered_at timestamptz;

update public.zoho_email_metadata
set classification_status = 'retry_scheduled',
    next_retry_at = now(),
    updated_at = now()
where classification_status = 'failed';

alter table public.zoho_email_metadata
  add constraint zoho_email_metadata_classification_status_check
    check (
      classification_status in (
        'pending',
        'processing',
        'retry_scheduled',
        'classified',
        'review',
        'dead_letter'
      )
    );

create table if not exists public.zoho_sync_checkpoints (
  mailbox_email text primary key,
  last_seen_message_id text,
  last_seen_received_at timestamptz,
  last_successful_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.zoho_sync_checkpoints enable row level security;

revoke all on public.zoho_sync_checkpoints from public, anon, authenticated;
grant select, insert, update, delete on public.zoho_sync_checkpoints to service_role;

create index if not exists idx_zoho_email_metadata_queue_ready
  on public.zoho_email_metadata (
    mailbox_email,
    next_retry_at,
    claim_expires_at,
    received_at
  )
  where classification_status in ('pending', 'retry_scheduled', 'processing');

create index if not exists idx_zoho_email_metadata_dashboard_latest
  on public.zoho_email_metadata (received_at desc);

create index if not exists idx_zoho_email_metadata_client_received
  on public.zoho_email_metadata (client_id, received_at desc)
  where client_id is not null;

create index if not exists idx_zoho_email_metadata_original_recipient
  on public.zoho_email_metadata (original_recipient, received_at desc)
  where original_recipient is not null;

create or replace function public.claim_zoho_email_rows(
  p_mailbox_email text,
  p_worker_id text,
  p_limit integer default 50,
  p_claim_ttl_seconds integer default 600,
  p_now timestamptz default now()
)
returns setof public.zoho_email_metadata
language sql
security definer
set search_path = public
as $$
  with eligible as (
    select id
    from public.zoho_email_metadata
    where mailbox_email = p_mailbox_email
      and classification_status in ('pending', 'retry_scheduled', 'processing')
      and (
        classification_status = 'pending'
        or (
          classification_status = 'retry_scheduled'
          and (next_retry_at is null or next_retry_at <= p_now)
        )
        or (
          classification_status = 'processing'
          and claim_expires_at is not null
          and claim_expires_at <= p_now
        )
      )
      and (
        claim_expires_at is null or claim_expires_at <= p_now
      )
    order by received_at asc
    limit greatest(p_limit, 0)
    for update skip locked
  ),
  claimed as (
    update public.zoho_email_metadata z
    set classification_status = 'processing',
        claimed_by = p_worker_id,
        claimed_at = p_now,
        claim_expires_at = p_now + make_interval(secs => p_claim_ttl_seconds),
        attempt_count = coalesce(z.attempt_count, 0) + 1,
        last_attempt_at = p_now,
        updated_at = p_now
    from eligible
    where z.id = eligible.id
    returning z.*
  )
  select *
  from claimed;
$$;

revoke all on function public.claim_zoho_email_rows(text, text, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_zoho_email_rows(text, text, integer, integer, timestamptz)
  to service_role;
