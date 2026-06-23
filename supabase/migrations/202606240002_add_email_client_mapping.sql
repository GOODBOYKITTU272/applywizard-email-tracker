-- Phase 4A: add client_id mapping column to zoho_email_metadata.
--
-- BLOCKER NOTE: No stable `clients` table exists in Supabase yet.
-- Client data lives in lib/mockData.ts (mock only).
-- Therefore: no foreign key constraint is added here.
-- When a real clients table is migrated to Supabase, add:
--   alter table public.zoho_email_metadata
--     add constraint fk_email_client
--       foreign key (client_id) references public.clients(id) on delete set null;
--
-- client_id is stored as uuid to match the expected future clients PK type.
-- For now, values are written from mock data lookups and are not DB-enforced.

alter table public.zoho_email_metadata
  add column client_id uuid;
