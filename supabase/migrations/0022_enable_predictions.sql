-- ============================================================
-- 0022_enable_predictions.sql
-- Enable prediction markets for production
-- ============================================================

-- Enable prediction markets
UPDATE system_config SET value = 'true' WHERE key = 'predictions_enabled';
UPDATE system_config SET value = 'true' WHERE key = 'prediction_ai_generation';

-- Set reasonable defaults for production
UPDATE system_config SET value = '10' WHERE key = 'prediction_min_stake';
UPDATE system_config SET value = '5000' WHERE key = 'prediction_max_stake';
UPDATE system_config SET value = '5.00' WHERE key = 'prediction_fee_pct';
