BEGIN;

-- Fix 1: Enforce unique advertiser wallet account mapping.
ALTER TABLE advertiser_accounts
  ADD CONSTRAINT advertiser_accounts_wallet_address_unique UNIQUE (wallet_address);

-- Fix 2: Protect opinion_polls from anonymous/public reads.
ALTER TABLE opinion_polls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opinion_polls_deny_all ON opinion_polls;
CREATE POLICY opinion_polls_deny_all ON opinion_polls AS RESTRICTIVE FOR ALL USING (false);

-- Fix 3: Enable deny-all RLS on remaining sensitive tables.
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sources_deny_all ON sources;
CREATE POLICY sources_deny_all ON sources AS RESTRICTIVE FOR ALL USING (false);

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS system_config_deny_all ON system_config;
CREATE POLICY system_config_deny_all ON system_config AS RESTRICTIVE FOR ALL USING (false);

ALTER TABLE threat_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS threat_alerts_deny_all ON threat_alerts;
CREATE POLICY threat_alerts_deny_all ON threat_alerts AS RESTRICTIVE FOR ALL USING (false);

ALTER TABLE custody_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS custody_ledger_deny_all ON custody_ledger;
CREATE POLICY custody_ledger_deny_all ON custody_ledger AS RESTRICTIVE FOR ALL USING (false);

ALTER TABLE model_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_runs_deny_all ON model_runs;
CREATE POLICY model_runs_deny_all ON model_runs AS RESTRICTIVE FOR ALL USING (false);

ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ingestion_jobs_deny_all ON ingestion_jobs;
CREATE POLICY ingestion_jobs_deny_all ON ingestion_jobs AS RESTRICTIVE FOR ALL USING (false);

ALTER TABLE push_receipts_pending ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_receipts_pending_deny_all ON push_receipts_pending;
CREATE POLICY push_receipts_pending_deny_all ON push_receipts_pending AS RESTRICTIVE FOR ALL USING (false);

ALTER TABLE openrouter_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS openrouter_models_deny_all ON openrouter_models;
CREATE POLICY openrouter_models_deny_all ON openrouter_models AS RESTRICTIVE FOR ALL USING (false);

ALTER TABLE alert_review_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alert_review_log_deny_all ON alert_review_log;
CREATE POLICY alert_review_log_deny_all ON alert_review_log AS RESTRICTIVE FOR ALL USING (false);

ALTER TABLE feed_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feed_items_deny_all ON feed_items;
CREATE POLICY feed_items_deny_all ON feed_items AS RESTRICTIVE FOR ALL USING (false);

-- Fix 4: Speed up claimability scans for pending payouts.
CREATE INDEX IF NOT EXISTS idx_prediction_payouts_claimable
  ON prediction_payouts (wallet, status, claimable_at)
  WHERE status = 'pending';

COMMIT;
