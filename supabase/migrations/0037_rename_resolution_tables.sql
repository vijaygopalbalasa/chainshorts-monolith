-- Migration 0037: Create helius_webhook_events table for webhook deduplication
-- Note: prediction_resolutions already exists from migration 0033

-- ── Create helius_webhook_events (for Helius webhook deduplication) ────────────
CREATE TABLE IF NOT EXISTS helius_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  tx_hash TEXT,
  payload JSONB NOT NULL,
  dedup_key TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_helius_webhook_events_observed ON helius_webhook_events (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_helius_webhook_events_tx ON helius_webhook_events (tx_hash);

-- Enable RLS with deny-all policy
ALTER TABLE helius_webhook_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'helius_webhook_events' AND policyname = 'helius_webhook_events_deny_all'
  ) THEN
    CREATE POLICY "helius_webhook_events_deny_all" ON helius_webhook_events AS RESTRICTIVE FOR ALL USING (false);
  END IF;
END $$;
