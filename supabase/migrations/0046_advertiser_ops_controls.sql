-- 0046_advertiser_ops_controls.sql
-- Adds campaign approval workflow + advertiser account suspension controls.

BEGIN;

ALTER TABLE sponsored_cards
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE sponsored_cards
  DROP CONSTRAINT IF EXISTS sponsored_cards_approval_status_check;

ALTER TABLE sponsored_cards
  ADD CONSTRAINT sponsored_cards_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));

UPDATE sponsored_cards
SET approval_status = 'approved'
WHERE approval_status IS NULL;

UPDATE sponsored_cards
SET approved_at = COALESCE(approved_at, created_at),
    approved_by = COALESCE(NULLIF(approved_by, ''), 'system_migration')
WHERE approval_status = 'approved';

ALTER TABLE advertiser_accounts
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspension_reason text;

ALTER TABLE advertiser_accounts
  DROP CONSTRAINT IF EXISTS advertiser_accounts_account_status_check;

ALTER TABLE advertiser_accounts
  ADD CONSTRAINT advertiser_accounts_account_status_check
  CHECK (account_status IN ('active', 'suspended'));

CREATE INDEX IF NOT EXISTS idx_sponsored_cards_approval_status
  ON sponsored_cards (approval_status, is_active, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_advertiser_accounts_status
  ON advertiser_accounts (account_status, created_at DESC);

COMMIT;
