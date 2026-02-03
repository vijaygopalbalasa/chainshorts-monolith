-- Track cashout SKR transfer results on the stake row for audit trail
ALTER TABLE prediction_stakes
  ADD COLUMN IF NOT EXISTS cashout_tx_signature TEXT,
  ADD COLUMN IF NOT EXISTS cashout_transfer_status TEXT
    CHECK (cashout_transfer_status IN ('complete', 'failed'));
