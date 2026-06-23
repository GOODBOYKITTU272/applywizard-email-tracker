-- Phase 4A: add email routing fields to zoho_email_metadata.
-- All new columns are nullable (except routing_status which has a safe default)
-- so existing classified rows remain valid and readable without any backfill.

alter table public.zoho_email_metadata
  add column original_recipient text,
  add column email_direction text
    check (email_direction in ('incoming', 'outgoing')),
  add column routing_confidence text
    check (routing_confidence in ('single', 'multi_candidate', 'fallback')),
  add column routing_status text not null default 'pending'
    check (routing_status in ('pending', 'routed', 'unroutable', 'unmatched', 'internal'));
