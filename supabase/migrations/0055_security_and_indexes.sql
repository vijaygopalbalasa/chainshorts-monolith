-- 0055: security hardening + missing indexes
-- (a) RLS on advertiser_campaign_payments — missed in 0049
-- (b) wallet index on payment_intents — all queries filter by wallet
-- (c) card_id index on advertiser_campaign_payments — ON DELETE CASCADE scan + future queries

BEGIN;

-- (a) RLS: advertiser_campaign_payments financial table must have deny-all policy
ALTER TABLE advertiser_campaign_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY advertiser_campaign_payments_deny_all
  ON advertiser_campaign_payments
  AS RESTRICTIVE FOR ALL
  USING (false);

-- (b) payment_intents: queries join on (kind, reference_type, reference_id, wallet)
--     The existing reference_idx doesn't cover wallet; add covering index
CREATE INDEX IF NOT EXISTS payment_intents_wallet_kind_idx
  ON payment_intents (wallet, kind, status, expires_at);

-- (c) advertiser_campaign_payments: ON DELETE CASCADE from sponsored_cards needs card_id index
CREATE INDEX IF NOT EXISTS idx_advertiser_campaign_payments_card_id
  ON advertiser_campaign_payments (card_id);

COMMIT;
