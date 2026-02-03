-- 0047_feed_injection_runtime_config.sql
-- Runtime controls for feed card injection cadence (sponsored + prediction cards)

BEGIN;

INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('feed_prediction_min_gap', '5', 'integer', 'Prediction Min Gap', 'Minimum organic cards between injected prediction cards', 'feed'),
  ('feed_prediction_max_gap', '8', 'integer', 'Prediction Max Gap', 'Maximum organic cards between injected prediction cards', 'feed'),
  ('feed_sponsored_min_gap', '2', 'integer', 'Sponsored Min Gap', 'Minimum organic cards between injected sponsored cards', 'feed'),
  ('feed_sponsored_max_gap', '4', 'integer', 'Sponsored Max Gap', 'Maximum organic cards between injected sponsored cards', 'feed'),
  ('feed_max_predictions_per_page', '3', 'integer', 'Max Predictions Per Page', 'Maximum injected prediction cards per feed page', 'feed')
ON CONFLICT (key) DO NOTHING;

COMMIT;
