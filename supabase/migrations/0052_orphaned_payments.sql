BEGIN;

CREATE TABLE IF NOT EXISTS orphaned_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_signature TEXT NOT NULL UNIQUE,
  wallet TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('prediction_stake', 'dispute_deposit', 'advertiser_campaign')),
  expected_amount_skr BIGINT NOT NULL CHECK (expected_amount_skr >= 0),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('poll', 'campaign')),
  reference_id TEXT NOT NULL,
  failure_reason TEXT NOT NULL CHECK (char_length(failure_reason) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved')),
  admin_notes TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orphaned_payments_status_created_idx
  ON orphaned_payments (status, created_at DESC);

ALTER TABLE orphaned_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'orphaned_payments'
      AND policyname = 'orphaned_payments_deny_all'
  ) THEN
    CREATE POLICY orphaned_payments_deny_all
      ON orphaned_payments
      AS RESTRICTIVE
      FOR ALL
      USING (false);
  END IF;
END $$;

COMMIT;
