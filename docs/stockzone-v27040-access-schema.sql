-- StockZone v2.7.0.40: additional access-only tables. No existing table or data changed.
CREATE TABLE IF NOT EXISTS public.sz_access_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS public.sz_access_sessions (
  id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  token_hash CHAR(64) PRIMARY KEY,
  invite_id UUID REFERENCES public.sz_access_invites(id),
  label TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sz_access_session_invite_idx ON public.sz_access_sessions(invite_id);
CREATE INDEX IF NOT EXISTS sz_access_session_status_idx ON public.sz_access_sessions(expires_at) WHERE revoked_at IS NULL;
