-- Phase: controlled historical classification release. Lets a small,
-- human-gated batch of historical_ingested rows enter the existing
-- classify queue as 'pending', tagged with which release batch moved
-- them. No change to the live worker, sync path, or classify logic.

alter table public.zoho_email_metadata
  add column release_batch_id uuid;

create table public.zoho_release_batches (
  id uuid primary key default gen_random_uuid(),
  mailbox_email text not null,
  requested_size integer not null,
  released_count integer not null default 0,
  status text not null default 'released'
    check (status in ('released', 'completed', 'failed')),
  dry_run boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.zoho_release_batches enable row level security;

revoke all on public.zoho_release_batches from public, anon, authenticated;
grant select, insert, update, delete on public.zoho_release_batches to service_role;

create or replace function public.release_historical_batch(
  p_mailbox_email text,
  p_batch_id uuid,
  p_limit integer
)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  with eligible as (
    select id
    from public.zoho_email_metadata
    where mailbox_email = p_mailbox_email
      and classification_status = 'historical_ingested'
    order by received_at desc
    limit least(greatest(p_limit, 0), 100)
    for update skip locked
  ),
  released as (
    update public.zoho_email_metadata z
    set classification_status = 'pending',
        release_batch_id = p_batch_id,
        updated_at = now()
    from eligible
    where z.id = eligible.id
    returning z.id
  )
  select id from released;
$$;

revoke all on function public.release_historical_batch(text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.release_historical_batch(text, uuid, integer)
  to service_role;
