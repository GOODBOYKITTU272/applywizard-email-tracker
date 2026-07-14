-- Phase: Human Review + Safe Email Preview. Preserves the AI's
-- original category (never overwritten) and adds a human-decision
-- overlay: human_category (null until a human acts), reviewed_by,
-- reviewed_at, and an optional correction_reason. Additive only.
alter table public.zoho_email_metadata
  add column human_category text,
  add column reviewed_by text,
  add column reviewed_at timestamptz,
  add column correction_reason text;
