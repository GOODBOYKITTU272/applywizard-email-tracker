create table if not exists public.zoho_backfill_checkpoints (
  mailbox_email text primary key,
  next_start integer not null default 0,
  pages_completed integer not null default 0,
  total_fetched integer not null default 0,
  total_inserted integer not null default 0,
  total_updated integer not null default 0,
  last_message_id text,
  last_received_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.zoho_backfill_checkpoints enable row level security;

revoke all on public.zoho_backfill_checkpoints from public, anon, authenticated;
grant select, insert, update, delete on public.zoho_backfill_checkpoints to service_role;
