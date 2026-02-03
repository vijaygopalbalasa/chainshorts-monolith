BEGIN;

UPDATE prediction_payouts
SET claimable_at = created_at + interval '48 hours'
WHERE claimable_at IS NOT NULL
  AND transfer_status = 'pending';

COMMIT;
