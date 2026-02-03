ALTER TABLE prediction_stakes
  DROP CONSTRAINT IF EXISTS prediction_stakes_status_check;

ALTER TABLE prediction_stakes
  ADD CONSTRAINT prediction_stakes_status_check
  CHECK (status IN ('active', 'cashing_out', 'won', 'lost', 'cancelled', 'claimed'));

ALTER TABLE prediction_stakes
  DROP CONSTRAINT IF EXISTS prediction_stakes_cashout_transfer_status_check;

ALTER TABLE prediction_stakes
  ADD CONSTRAINT prediction_stakes_cashout_transfer_status_check
  CHECK (cashout_transfer_status IN ('in_progress', 'complete', 'failed'));
