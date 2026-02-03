-- ============================================================
-- 0021_payout_transfers.sql
-- Add columns to track SKR payout transfers to winners
-- ============================================================

-- Add transfer tracking columns to prediction_payouts
ALTER TABLE prediction_payouts
  ADD COLUMN IF NOT EXISTS tx_signature TEXT,
  ADD COLUMN IF NOT EXISTS transfer_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (transfer_status IN ('pending', 'completed', 'failed', 'manual_required')),
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transfer_error TEXT,
  ADD COLUMN IF NOT EXISTS transfer_attempts INTEGER NOT NULL DEFAULT 0;

-- Index for finding failed transfers that need retry
CREATE INDEX IF NOT EXISTS idx_prediction_payouts_transfer_status
  ON prediction_payouts (transfer_status, created_at)
  WHERE transfer_status IN ('failed', 'pending');

-- Index for finding claimed but not transferred payouts
CREATE INDEX IF NOT EXISTS idx_prediction_payouts_claimed_pending_transfer
  ON prediction_payouts (status, transfer_status, claimed_at)
  WHERE status = 'claimed' AND transfer_status != 'completed';

-- Add system config for payout retries
INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('payout_transfer_enabled', 'true', 'boolean', 'Auto Payout Transfer', 'Automatically transfer SKR to winners on claim', 'predictions'),
  ('payout_transfer_max_retries', '3', 'integer', 'Max Payout Retries', 'Maximum retry attempts for failed payout transfers', 'predictions')
ON CONFLICT (key) DO NOTHING;
