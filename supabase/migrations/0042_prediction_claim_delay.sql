ALTER TABLE prediction_payouts
  ADD COLUMN IF NOT EXISTS claimable_at TIMESTAMPTZ;

-- Existing payouts should stay claimable immediately.
UPDATE prediction_payouts
SET claimable_at = COALESCE(claimable_at, created_at)
WHERE claimable_at IS NULL;
