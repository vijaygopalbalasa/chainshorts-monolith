BEGIN;

-- Keep a single payout row per stake to support ON CONFLICT (stake_id) flows.
-- Prefer claimed rows first, then oldest rows.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY stake_id
      ORDER BY
        CASE WHEN status = 'claimed' THEN 0 ELSE 1 END,
        created_at ASC,
        id ASC
    ) AS row_num
  FROM prediction_payouts
)
DELETE FROM prediction_payouts p
USING ranked r
WHERE p.id = r.id
  AND r.row_num > 1;

ALTER TABLE prediction_payouts
  ADD CONSTRAINT prediction_payouts_stake_id_unique UNIQUE (stake_id);

COMMIT;
