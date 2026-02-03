-- Migration 0025: Self-serve advertiser accounts (Privy-authenticated)

CREATE TABLE IF NOT EXISTS advertiser_accounts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  privy_user_id  text        NOT NULL UNIQUE,
  email          text,
  wallet_address text,
  company_name   text,
  website_url    text,
  is_onboarded   boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE INDEX ON advertiser_accounts (privy_user_id);

CREATE TABLE IF NOT EXISTS advertiser_sessions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token  text        NOT NULL UNIQUE,
  advertiser_id  uuid        NOT NULL REFERENCES advertiser_accounts(id) ON DELETE CASCADE,
  expires_at     timestamptz NOT NULL,
  invalidated_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON advertiser_sessions (session_token) WHERE invalidated_at IS NULL;

ALTER TABLE sponsored_cards
  ADD COLUMN IF NOT EXISTS advertiser_id uuid REFERENCES advertiser_accounts(id) ON DELETE SET NULL;

ALTER TABLE sponsored_cards
  ADD COLUMN IF NOT EXISTS card_format text NOT NULL DEFAULT 'classic';
