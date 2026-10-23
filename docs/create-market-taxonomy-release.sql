-- Only APPROVED, SZ-鐵證 verified actions may be inserted here. NEVER pending/automatically detected events.
CREATE TABLE IF NOT EXISTS public.market_taxonomy_release (
  change_id text PRIMARY KEY CHECK (change_id ~ '^[a-f0-9]{24}$'),
  stock_code text NOT NULL,
  market text NOT NULL CHECK (market IN ('上市','上櫃')),
  tag_id text,
  approved_importance text NOT NULL CHECK (approved_importance IN ('core','related','removed','unchanged')),
  evidence text NOT NULL CHECK (char_length(trim(evidence)) >= 10),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  release_version text NOT NULL DEFAULT 'iron-verified',
  CHECK (approved_importance='unchanged' OR tag_id IS NOT NULL)
);
-- IMPORTANT: no automatic scanner permission to INSERT into this table.
