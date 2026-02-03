ALTER TABLE prediction_payouts
  ADD COLUMN IF NOT EXISTS claimable_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS prediction_payouts_claimable_notify_idx
  ON prediction_payouts (claimable_at)
  WHERE status = 'pending' AND claimable_notified_at IS NULL;
