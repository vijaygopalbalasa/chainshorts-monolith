-- 0048_sponsored_placement_strategy.sql
-- Adds placement targeting so campaigns can run in feed, predict, or both.

BEGIN;

ALTER TABLE sponsored_cards
  ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'feed';

ALTER TABLE sponsored_cards
  DROP CONSTRAINT IF EXISTS sponsored_cards_placement_check;

ALTER TABLE sponsored_cards
  ADD CONSTRAINT sponsored_cards_placement_check
  CHECK (placement IN ('feed', 'predict', 'both'));

UPDATE sponsored_cards
SET placement = 'feed'
WHERE placement IS NULL;

CREATE INDEX IF NOT EXISTS idx_sponsored_cards_placement_active
  ON sponsored_cards (placement, approval_status, is_active, starts_at, ends_at);

INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('predict_sponsored_enabled', 'true', 'boolean', 'Predict Sponsored Enabled', 'Enable sponsored cards in Predict tab', 'feed'),
  ('predict_sponsored_min_gap', '3', 'integer', 'Predict Sponsored Min Gap', 'Minimum number of prediction cards between sponsored cards in Predict tab', 'feed'),
  ('predict_sponsored_max_gap', '6', 'integer', 'Predict Sponsored Max Gap', 'Maximum number of prediction cards between sponsored cards in Predict tab', 'feed'),
  ('predict_max_sponsored_per_page', '2', 'integer', 'Predict Sponsored Max Per Page', 'Maximum sponsored cards injected in Predict tab per page', 'feed')
ON CONFLICT (key) DO NOTHING;

COMMIT;
