-- 0049_advertiser_campaign_billing.sql
-- Adds prepaid billing gates for advertiser-owned sponsored campaigns.

BEGIN;

ALTER TABLE sponsored_cards
  ADD COLUMN IF NOT EXISTS billing_amount_skr integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS payment_tx_signature text,
  ADD COLUMN IF NOT EXISTS payment_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_note text;

ALTER TABLE sponsored_cards
  DROP CONSTRAINT IF EXISTS sponsored_cards_billing_status_check;

ALTER TABLE sponsored_cards
  ADD CONSTRAINT sponsored_cards_billing_status_check
  CHECK (billing_status IN ('not_required', 'approval_pending', 'payment_required', 'paid'));

CREATE INDEX IF NOT EXISTS idx_sponsored_cards_billing_state
  ON sponsored_cards (billing_status, approval_status, is_active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS advertiser_campaign_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id uuid NOT NULL REFERENCES advertiser_accounts(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES sponsored_cards(id) ON DELETE CASCADE,
  tx_signature text NOT NULL UNIQUE,
  amount_skr integer NOT NULL CHECK (amount_skr > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_advertiser_campaign_payments_advertiser
  ON advertiser_campaign_payments (advertiser_id, created_at DESC);

UPDATE sponsored_cards
SET
  billing_amount_skr = CASE
    WHEN advertiser_id IS NULL THEN 0
    WHEN COALESCE(billing_amount_skr, 0) > 0 THEN billing_amount_skr
    ELSE GREATEST(
      1,
      CEIL(COALESCE(impression_limit, 5000)::numeric / 1000.0)::int *
      CEIL(
        (
          CASE card_format
            WHEN 'banner' THEN 18
            WHEN 'spotlight' THEN 30
            ELSE 12
          END
          *
          CASE placement
            WHEN 'predict' THEN 150
            WHEN 'both' THEN 225
            ELSE 100
          END
        )::numeric / 100.0
      )::int
    )
  END,
  billing_status = CASE
    WHEN advertiser_id IS NULL THEN 'not_required'
    WHEN approval_status = 'approved' THEN 'payment_required'
    ELSE 'approval_pending'
  END
WHERE billing_status IS NULL
   OR billing_status = ''
   OR billing_status = 'not_required';

INSERT INTO system_config
  (key, value, value_type, label, description, category, updated_by)
VALUES
  (
    'sponsored_default_impression_limit',
    '5000',
    'integer',
    'Default Sponsored Impression Pack',
    'Default impression package used when an advertiser does not specify a cap.',
    'ads',
    'migration_0049'
  ),
  (
    'sponsored_cpm_classic_skr',
    '12',
    'integer',
    'Sponsored CPM: Classic',
    'SKR charged per 1,000 impressions for classic sponsored cards.',
    'ads',
    'migration_0049'
  ),
  (
    'sponsored_cpm_banner_skr',
    '18',
    'integer',
    'Sponsored CPM: Banner',
    'SKR charged per 1,000 impressions for banner sponsored cards.',
    'ads',
    'migration_0049'
  ),
  (
    'sponsored_cpm_spotlight_skr',
    '30',
    'integer',
    'Sponsored CPM: Spotlight',
    'SKR charged per 1,000 impressions for spotlight sponsored cards.',
    'ads',
    'migration_0049'
  ),
  (
    'sponsored_predict_multiplier_pct',
    '150',
    'integer',
    'Predict Placement Multiplier',
    'Percent multiplier applied to sponsored pricing for predict-tab only placements.',
    'ads',
    'migration_0049'
  ),
  (
    'sponsored_both_multiplier_pct',
    '225',
    'integer',
    'Feed + Predict Multiplier',
    'Percent multiplier applied to sponsored pricing for placements that run in both feed and predict.',
    'ads',
    'migration_0049'
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;
