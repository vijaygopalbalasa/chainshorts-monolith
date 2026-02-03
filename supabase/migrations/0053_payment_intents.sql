CREATE TABLE IF NOT EXISTS payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('prediction_stake', 'dispute_deposit', 'advertiser_campaign')),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('poll', 'campaign')),
  reference_id TEXT NOT NULL,
  expected_amount_skr BIGINT NOT NULL CHECK (expected_amount_skr >= 0),
  metadata JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  tx_signature TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_intents_status_expires_idx
  ON payment_intents (status, expires_at);

CREATE INDEX IF NOT EXISTS payment_intents_reference_idx
  ON payment_intents (kind, reference_type, reference_id, status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_tx_signature_unique
  ON payment_intents (tx_signature)
  WHERE tx_signature IS NOT NULL;

ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_intents'
      AND policyname = 'payment_intents_deny_all'
  ) THEN
    CREATE POLICY payment_intents_deny_all
      ON payment_intents
      AS RESTRICTIVE
      FOR ALL
      USING (false);
  END IF;
END $$;
