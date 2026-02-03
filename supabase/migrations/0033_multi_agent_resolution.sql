-- Migration 0033: Multi-Agent Resolution Columns
-- Adds tracking for 3-LLM consensus resolution in prediction markets

BEGIN;

-- Add multi-agent tracking columns to prediction_resolutions
ALTER TABLE prediction_resolutions
  ADD COLUMN IF NOT EXISTS agent1_model TEXT,
  ADD COLUMN IF NOT EXISTS agent1_outcome TEXT CHECK (agent1_outcome IN ('yes', 'no', 'indeterminate')),
  ADD COLUMN IF NOT EXISTS agent1_confidence NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS agent1_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS agent1_sources JSONB,
  ADD COLUMN IF NOT EXISTS agent2_model TEXT,
  ADD COLUMN IF NOT EXISTS agent2_outcome TEXT CHECK (agent2_outcome IN ('yes', 'no', 'indeterminate')),
  ADD COLUMN IF NOT EXISTS agent2_confidence NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS agent2_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS agent2_sources JSONB,
  ADD COLUMN IF NOT EXISTS agent3_model TEXT,
  ADD COLUMN IF NOT EXISTS agent3_outcome TEXT CHECK (agent3_outcome IN ('yes', 'no', 'indeterminate')),
  ADD COLUMN IF NOT EXISTS agent3_confidence NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS agent3_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS agent3_sources JSONB,
  ADD COLUMN IF NOT EXISTS consensus_outcome TEXT CHECK (consensus_outcome IN ('yes', 'no', 'indeterminate', 'no_consensus')),
  ADD COLUMN IF NOT EXISTS consensus_confidence NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS consensus_type TEXT CHECK (consensus_type IN ('unanimous', 'majority', 'no_consensus')),
  ADD COLUMN IF NOT EXISTS resolution_method TEXT CHECK (resolution_method IN ('multi_agent', 'coingecko_price', 'community_majority', 'admin_manual'));

-- System config for multi-agent models
INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('agent_model_resolver_1', 'google/gemini-2.5-flash-preview', 'string', 'Resolver Agent 1', 'First LLM for multi-agent resolution', 'models'),
  ('agent_model_resolver_2', 'anthropic/claude-3.5-sonnet', 'string', 'Resolver Agent 2', 'Second LLM for multi-agent resolution', 'models'),
  ('agent_model_resolver_3', 'openai/gpt-4o', 'string', 'Resolver Agent 3', 'Third LLM for multi-agent resolution', 'models'),
  ('resolution_consensus_threshold', '2', 'integer', 'Consensus Threshold', 'Minimum agents that must agree (2 or 3)', 'predictions')
ON CONFLICT (key) DO NOTHING;

COMMIT;
