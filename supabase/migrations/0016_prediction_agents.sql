-- 0016_prediction_agents.sql
-- AI-powered prediction market automation: auto-generate questions from news,
-- auto-resolve outcomes via LLM reasoning. Removes deep dive feature.

-- ============================================================
-- 1. Extend opinion_polls for AI-generated predictions
-- ============================================================
ALTER TABLE opinion_polls
  ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN DEFAULT false;

ALTER TABLE opinion_polls
  ADD COLUMN IF NOT EXISTS generator_confidence NUMERIC(3, 2);

ALTER TABLE opinion_polls
  ADD COLUMN IF NOT EXISTS verifier_confidence NUMERIC(3, 2);

ALTER TABLE opinion_polls
  ADD COLUMN IF NOT EXISTS resolution_rule JSONB;
-- resolution_rule: { kind: "price_above"|"price_below"|"event_occurs"|"community_majority", symbol?, target? }

-- Index for finding AI-generated polls needing resolution
CREATE INDEX IF NOT EXISTS idx_opinion_polls_ai_pending
  ON opinion_polls (ai_generated, deadline_at)
  WHERE ai_generated = true AND resolved_outcome IS NULL;

-- ============================================================
-- 2. Prediction resolutions table (AI resolver output)
-- ============================================================
CREATE TABLE IF NOT EXISTS prediction_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id TEXT NOT NULL REFERENCES opinion_polls(id) ON DELETE CASCADE,
  resolver_outcome TEXT CHECK (resolver_outcome IN ('yes', 'no', 'indeterminate')),
  resolver_confidence NUMERIC(3, 2),
  resolver_sources JSONB,           -- Array of URLs/evidence used
  resolver_reasoning TEXT,          -- LLM's reasoning chain
  final_outcome TEXT,               -- After human review if needed
  resolved_by TEXT,                 -- 'ai_auto' | 'admin:<wallet>'
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prediction_resolutions_poll
  ON prediction_resolutions (poll_id);

CREATE INDEX IF NOT EXISTS idx_prediction_resolutions_pending
  ON prediction_resolutions (resolved_by)
  WHERE resolved_by IS NULL;

-- RLS: deny direct access
ALTER TABLE prediction_resolutions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prediction_resolutions_deny_all" ON prediction_resolutions;
CREATE POLICY "prediction_resolutions_deny_all"
  ON prediction_resolutions AS RESTRICTIVE FOR ALL USING (false);

-- ============================================================
-- 3. Prediction agent model config keys
-- ============================================================
INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('agent_model_question_generator', 'qwen/qwen-2.5-72b-instruct:free', 'string', 'Question Generator', 'LLM for creating prediction questions from news', 'models'),
  ('agent_model_question_verifier', 'meta-llama/llama-3.3-70b-instruct:free', 'string', 'Question Verifier', 'LLM for validating prediction question quality', 'models'),
  ('agent_model_outcome_resolver', 'qwen/qwen-2.5-72b-instruct:free', 'string', 'Outcome Resolver', 'LLM for resolving prediction outcomes', 'models')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 4. Feature flag for AI prediction generation
-- ============================================================
INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('prediction_ai_generation', 'true', 'boolean', 'AI Prediction Generation', 'Enable AI-powered prediction market creation from news', 'features')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 5. Cleanup: Remove deprecated/duplicate keys
-- ============================================================

-- Remove old relevance filter key (wrong name from 0013, replaced by agent_model_relevance_filter in 0015)
DELETE FROM system_config WHERE key = 'agent_model_relevance';

-- Remove deep dive feature and model keys (feature removed)
DELETE FROM system_config WHERE key = 'deep_dive_reports_enabled';
DELETE FROM system_config WHERE key = 'agent_model_deep_dive';
DELETE FROM system_config WHERE key = 'agent_model_deep_dive_fallback';

-- ============================================================
-- 6. Track articles that have had predictions generated
-- ============================================================
CREATE TABLE IF NOT EXISTS article_predictions (
  article_id TEXT NOT NULL REFERENCES feed_items(id) ON DELETE CASCADE,
  poll_id TEXT NOT NULL REFERENCES opinion_polls(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (article_id, poll_id)
);

CREATE INDEX IF NOT EXISTS idx_article_predictions_article
  ON article_predictions (article_id);

-- RLS: deny direct access
ALTER TABLE article_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "article_predictions_deny_all" ON article_predictions;
CREATE POLICY "article_predictions_deny_all"
  ON article_predictions AS RESTRICTIVE FOR ALL USING (false);
