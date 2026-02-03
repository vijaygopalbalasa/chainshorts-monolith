BEGIN;

-- 1. Rename billing amount column: SKR → USDC cents
ALTER TABLE sponsored_cards
  RENAME COLUMN billing_amount_skr TO billing_amount_usdc;

-- 2. Rename payment table column
ALTER TABLE advertiser_campaign_payments
  RENAME COLUMN amount_skr TO amount_usdc;

-- 3. Update existing campaigns: reset billing amounts to 0 (admin will re-approve with new USDC prices)
--    Campaigns that are already 'paid' keep their data but billing_amount_usdc will be in wrong unit.
--    Since there are no real paid campaigns yet, safe to reset. CONFIRM before applying to prod.
UPDATE sponsored_cards
  SET billing_amount_usdc = 0
  WHERE billing_status != 'paid';

-- 4. Add portrait CPM config key (and replace SKR keys with USDC cents keys)
INSERT INTO system_config (key, value, value_type, label, description, category, updated_by) VALUES
  ('sponsored_cpm_classic_usdc_cents',  '500',  'integer', 'Classic CPM (US cents)',   'CPM in US cents for classic format',   'ads', 'migration_0057'),
  ('sponsored_cpm_banner_usdc_cents',   '800',  'integer', 'Banner CPM (US cents)',    'CPM in US cents for banner format',    'ads', 'migration_0057'),
  ('sponsored_cpm_spotlight_usdc_cents','1500', 'integer', 'Spotlight CPM (US cents)', 'CPM in US cents for spotlight format', 'ads', 'migration_0057'),
  ('sponsored_cpm_portrait_usdc_cents', '2500', 'integer', 'Portrait CPM (US cents)',  'CPM in US cents for portrait format',  'ads', 'migration_0057')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

COMMIT;
