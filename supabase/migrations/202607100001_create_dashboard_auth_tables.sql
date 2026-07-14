create table public.dashboard_users (
  id uuid primary key default gen_random_uuid(),
  email text not null
    check (btrim(email) <> ''),
  email_normalized text generated always as (lower(email)) stored,
  role text not null
    check (role in ('admin_ceo', 'manager_ops', 'ca')),
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  totp_enabled boolean not null default false,
  totp_secret_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  constraint dashboard_users_email_normalized_unique unique (email_normalized)
);

alter table public.dashboard_users enable row level security;

revoke all on public.dashboard_users from public, anon, authenticated;
grant select, insert, update, delete on public.dashboard_users to service_role;

create table public.dashboard_email_otps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.dashboard_users(id) on delete cascade,
  otp_hash text not null
    check (btrim(otp_hash) <> ''),
  expires_at timestamptz not null,
  used_at timestamptz,
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  created_at timestamptz not null default now()
);

alter table public.dashboard_email_otps enable row level security;

revoke all on public.dashboard_email_otps from public, anon, authenticated;
grant select, insert, update, delete on public.dashboard_email_otps to service_role;

create index idx_dashboard_email_otps_user_id
  on public.dashboard_email_otps (user_id);

create index idx_dashboard_email_otps_expires_at
  on public.dashboard_email_otps (expires_at);

create index idx_dashboard_email_otps_unused
  on public.dashboard_email_otps (user_id, expires_at)
  where used_at is null;

create table public.dashboard_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.dashboard_users(id) on delete cascade,
  session_hash text not null
    check (btrim(session_hash) <> ''),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  constraint dashboard_sessions_session_hash_unique unique (session_hash)
);

alter table public.dashboard_sessions enable row level security;

revoke all on public.dashboard_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.dashboard_sessions to service_role;

create index idx_dashboard_sessions_user_id
  on public.dashboard_sessions (user_id);

create index idx_dashboard_sessions_expires_at
  on public.dashboard_sessions (expires_at);

create index idx_dashboard_sessions_active
  on public.dashboard_sessions (user_id, expires_at)
  where revoked_at is null;

create table public.dashboard_auth_audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.dashboard_users(id) on delete set null,
  email text,
  event_type text not null
    check (btrim(event_type) <> ''),
  success boolean not null,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now()
);

alter table public.dashboard_auth_audit_events enable row level security;

revoke all on public.dashboard_auth_audit_events from public, anon, authenticated;
grant select, insert, update, delete on public.dashboard_auth_audit_events to service_role;

create index idx_dashboard_auth_audit_events_user_id
  on public.dashboard_auth_audit_events (user_id);

create index idx_dashboard_auth_audit_events_email
  on public.dashboard_auth_audit_events (email);

create index idx_dashboard_auth_audit_events_event_type
  on public.dashboard_auth_audit_events (event_type);

create index idx_dashboard_auth_audit_events_created_at
  on public.dashboard_auth_audit_events (created_at);
