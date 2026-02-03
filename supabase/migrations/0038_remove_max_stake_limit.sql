-- Migration 0038: Remove max stake limit
-- Users can now stake any amount (minimum 10 SKR only, no maximum)

-- Update all existing markets to have effectively unlimited max stake
UPDATE opinion_polls
SET max_stake_skr = 999999999
WHERE is_prediction = true AND max_stake_skr < 999999999;

-- Update default in table (for future direct inserts)
ALTER TABLE opinion_polls
  ALTER COLUMN max_stake_skr SET DEFAULT 999999999;
