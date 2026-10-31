-- v2.7.0.50: owner/family sessions persist until individually revoked.
-- Safe before deployment of v2.7.0.50: v2.7.0.49 ignores permanent.
ALTER TABLE public.sz_access_sessions
 ADD COLUMN IF NOT EXISTS permanent BOOLEAN NOT NULL DEFAULT FALSE;
-- Preserve all already authorized and non-revoked devices.
UPDATE public.sz_access_sessions SET permanent=TRUE
 WHERE revoked_at IS NULL AND expires_at>now() AND permanent=FALSE;
-- Invitations are still time-limited, one-time use; no invite schema changes.
