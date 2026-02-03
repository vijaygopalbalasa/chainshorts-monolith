-- Add dust tracking column to platform fees
ALTER TABLE prediction_platform_fees 
  ADD COLUMN IF NOT EXISTS dust_skr INTEGER DEFAULT 0;

-- Add comment
COMMENT ON COLUMN prediction_platform_fees.dust_skr IS 'Rounding remainder swept to treasury';
