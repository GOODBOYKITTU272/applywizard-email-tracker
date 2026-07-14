-- Phase: Interview drilldown. Persist company_name/job_title that the
-- classifier already computes today but discards before saving. Additive,
-- nullable, no backfill of existing rows.
alter table public.zoho_email_metadata
  add column company_name text,
  add column job_title text;
