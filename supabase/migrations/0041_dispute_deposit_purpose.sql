-- Extend consumed_tx_signatures to support dispute deposits
ALTER TABLE consumed_tx_signatures
  DROP CONSTRAINT IF EXISTS consumed_tx_signatures_purpose_check;

ALTER TABLE consumed_tx_signatures
  ADD CONSTRAINT consumed_tx_signatures_purpose_check
  CHECK (purpose IN ('deep_dive', 'content_boost', 'prediction_stake', 'dispute_deposit'));
