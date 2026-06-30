update public.zoho_email_metadata
set reason = 'Classification reason redacted for safety.'
where reason is not null
  and reason <> 'Classification reason redacted for safety.'
  and reason ~* '(https?://|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\m\d{4,8}\M|[A-Z0-9_-]{24,}|"[^"\n]{8,}"|''[^''\n]{8,}''|```|content-type:|mime-version:|href=|<html|stack trace|traceback|raw response|provider output|exception:)';
