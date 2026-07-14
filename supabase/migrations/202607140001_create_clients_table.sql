-- Live Monitor V1 — minimal clients model (Option A: CA stored directly on the client).
-- Additive and safe for existing rows: reuses the existing nullable
-- zoho_email_metadata.client_id (added in 202606240002) and finally activates the
-- foreign key that migration deferred until a real clients table existed.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  recipient_email text not null,
  -- DB-enforced normalization (matches the dashboard_users.email_normalized pattern),
  -- extended with trim(). Its unique index doubles as the recipient lookup index.
  recipient_email_normalized text generated always as (lower(trim(recipient_email))) stored,
  assigned_ca_name text not null,
  assigned_ca_email text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_recipient_email_normalized_unique unique (recipient_email_normalized)
);

alter table public.clients enable row level security;

revoke all on public.clients from public, anon, authenticated;
grant select, insert, update, delete on public.clients to service_role;

-- Activate the FK that 202606240002 deferred. client_id stays nullable, so existing
-- email rows (client_id IS NULL) remain valid; deleting a client nulls the link
-- rather than removing the email.
alter table public.zoho_email_metadata
  add constraint fk_email_client
    foreign key (client_id) references public.clients(id) on delete set null;
