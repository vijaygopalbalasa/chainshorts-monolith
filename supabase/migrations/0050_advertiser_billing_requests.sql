-- 0050_advertiser_billing_requests.sql
-- Adds manual billing review / refund request workflow for advertiser campaigns.

CREATE TABLE IF NOT EXISTS advertiser_billing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id uuid NOT NULL REFERENCES advertiser_accounts(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES sponsored_cards(id) ON DELETE CASCADE,
  request_type text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  note text NOT NULL,
  admin_note text,
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE advertiser_billing_requests
  DROP CONSTRAINT IF EXISTS advertiser_billing_requests_type_check;

ALTER TABLE advertiser_billing_requests
  ADD CONSTRAINT advertiser_billing_requests_type_check
  CHECK (request_type IN ('billing_review', 'refund_request'));

ALTER TABLE advertiser_billing_requests
  DROP CONSTRAINT IF EXISTS advertiser_billing_requests_status_check;

ALTER TABLE advertiser_billing_requests
  ADD CONSTRAINT advertiser_billing_requests_status_check
  CHECK (status IN ('open', 'reviewing', 'resolved', 'rejected'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_advertiser_billing_requests_open
  ON advertiser_billing_requests (advertiser_id, card_id)
  WHERE status IN ('open', 'reviewing');

CREATE INDEX IF NOT EXISTS idx_advertiser_billing_requests_admin
  ON advertiser_billing_requests (status, created_at DESC);

ALTER TABLE advertiser_billing_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advertiser_billing_requests_deny_all ON advertiser_billing_requests;

CREATE POLICY advertiser_billing_requests_deny_all
  ON advertiser_billing_requests
  AS RESTRICTIVE
  FOR ALL
  USING (false);
