alter table public.zoho_email_metadata
  drop constraint if exists zoho_email_metadata_classification_status_check;

alter table public.zoho_email_metadata
  add constraint zoho_email_metadata_classification_status_check
    check (
      classification_status in (
        'pending',
        'processing',
        'retry_scheduled',
        'classified',
        'review',
        'dead_letter',
        'historical_ingested'
      )
    );

-- Future controlled release phase: explicitly promote selected
-- historical_ingested rows to pending after backlog validation.
-- This migration only permits holding historical rows; it does not release them.
