BEGIN;

-- 1. UNIQUE on prediction_platform_fees(poll_id) — worker ON CONFLICT needs this
ALTER TABLE prediction_platform_fees
  ADD CONSTRAINT prediction_platform_fees_poll_id_unique UNIQUE (poll_id);

-- 2. Missing updated_at on content_boosts — expiry cron writes to this column
ALTER TABLE content_boosts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3. Index for portfolio LEFT JOIN on prediction_payouts
CREATE INDEX IF NOT EXISTS idx_prediction_payouts_stake_id
  ON prediction_payouts (stake_id);

-- 4. Index for admin stats query on resolved predictions
CREATE INDEX IF NOT EXISTS idx_opinion_polls_prediction_resolved
  ON opinion_polls (is_prediction, resolved_at)
  WHERE is_prediction = true;

-- 5. Index for dispute expiration queries
CREATE INDEX IF NOT EXISTS idx_prediction_disputes_deadline
  ON prediction_disputes (challenge_deadline)
  WHERE status IN ('pending', 'investigating');

COMMIT;
