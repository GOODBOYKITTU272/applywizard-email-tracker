update public.zoho_email_metadata
set reason = 'Classification reason redacted for safety.'
where reason is not null
  and reason <> 'Classification reason redacted for safety.'
  and reason ~* '(https?://[^[:space:]]+|www\.[^[:space:]]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\m\d{4,8}\M|\m[A-Z0-9_-]{24,}\M|\m(?:password|passcode)\M|\m(?:api[-_ ]?key|access token|refresh token|bearer|authorization|client_secret|secret(?: key)?|private key)\M|"[^"\n]{8,}"|''[^''\n]{8,}''|```|^\s*[{[]|content-type:|mime-version:|href=|<html|stack trace|traceback|raw response|provider output|exception:|response body|headers:|.{161,})';
