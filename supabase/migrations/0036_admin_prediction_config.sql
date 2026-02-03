-- Migration 0036: Admin Prediction Controls Config
-- Adds system config keys for admin-controlled prediction market settings

BEGIN;

-- Auto-settle threshold (0.5 to 1.0, higher = stricter consensus required)
INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('resolution_auto_settle_threshold', '0.85', 'float', 'Auto-Settle Threshold', 'Confidence threshold for automatic settlement (0.5-1.0)', 'predictions')
ON CONFLICT (key) DO NOTHING;

-- Add index for faster dispute queries by status
CREATE INDEX IF NOT EXISTS idx_prediction_disputes_status_created
  ON prediction_disputes (status, created_at DESC);

-- Add resolved_at column to opinion_polls if not exists (for tracking resolution time)
ALTER TABLE opinion_polls
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

COMMIT;
