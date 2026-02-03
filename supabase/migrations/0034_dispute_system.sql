-- Migration 0034: Dispute System with Deposit Tracking
-- Enables users to challenge prediction market resolutions

BEGIN;

-- Drop existing table if it exists (was created in 0014 but may have been dropped)
DROP TABLE IF EXISTS prediction_disputes CASCADE;

-- Create prediction_disputes with enhanced schema
CREATE TABLE prediction_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id TEXT NOT NULL REFERENCES opinion_polls(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_urls JSONB DEFAULT '[]'::jsonb,
  deposit_skr INTEGER NOT NULL DEFAULT 50,
  deposit_tx_signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'investigating', 'upheld', 'rejected', 'expired')),
  resolution_note TEXT,
  resolved_by TEXT,
  refund_tx_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  challenge_deadline TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours'),
  UNIQUE (poll_id, wallet)
);

-- Indexes for efficient queries
CREATE INDEX idx_prediction_disputes_status ON prediction_disputes (status, created_at DESC);
CREATE INDEX idx_prediction_disputes_poll ON prediction_disputes (poll_id, status);
CREATE INDEX idx_prediction_disputes_wallet ON prediction_disputes (wallet, created_at DESC);

-- RLS: deny direct access (all access through API)
ALTER TABLE prediction_disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prediction_disputes_deny_all"
  ON prediction_disputes AS RESTRICTIVE FOR ALL USING (false);

-- Add freeze flag to opinion_polls for disputed markets
ALTER TABLE opinion_polls ADD COLUMN IF NOT EXISTS dispute_freeze BOOLEAN NOT NULL DEFAULT false;

-- System config for dispute settings
INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('dispute_deposit_skr', '50', 'integer', 'Dispute Deposit (SKR)', 'SKR deposit required to file dispute', 'predictions'),
  ('dispute_challenge_hours', '48', 'integer', 'Challenge Window (hours)', 'Hours after resolution to file dispute', 'predictions')
ON CONFLICT (key) DO NOTHING;

COMMIT;
