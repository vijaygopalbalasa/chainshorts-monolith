-- 0015_openrouter_models.sql
-- Dynamic OpenRouter model selection. Syncs available models from OpenRouter API
-- and stores agent model assignments in system_config for admin panel control.

-- Cache of available OpenRouter models (synced via admin panel)
CREATE TABLE IF NOT EXISTS openrouter_models (
  id                  TEXT PRIMARY KEY,    -- e.g., "qwen/qwen-2.5-72b-instruct:free"
  name                TEXT NOT NULL,       -- e.g., "Qwen 2.5 72B Instruct (free)"
  provider            TEXT NOT NULL,       -- e.g., "qwen"
  context_length      INTEGER,             -- e.g., 32768
  pricing_prompt      NUMERIC(20, 10) DEFAULT 0,   -- $/token (0 for free)
  pricing_completion  NUMERIC(20, 10) DEFAULT 0,   -- $/token
  is_free             BOOLEAN DEFAULT false,
  supports_tools      BOOLEAN DEFAULT false,
  supports_vision     BOOLEAN DEFAULT false,
  moderation          TEXT,                -- "moderated" | "unmoderated"
  last_synced_at      TIMESTAMPTZ DEFAULT now(),
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Index for filtering free models quickly
CREATE INDEX IF NOT EXISTS idx_openrouter_models_free ON openrouter_models(is_free) WHERE is_free = true;
CREATE INDEX IF NOT EXISTS idx_openrouter_models_provider ON openrouter_models(provider);

-- Seed agent model config keys using FREE tier models by default
-- These replace hardcoded env vars and allow admin panel control
INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('agent_model_relevance_filter',   'qwen/qwen-2.5-72b-instruct:free',       'string', 'Relevance Filter Model',   'LLM for relevance scoring (Stage 1)', 'models'),
  ('agent_model_fact_checker',       'meta-llama/llama-3.3-70b-instruct:free', 'string', 'Fact Checker Model',       'LLM for fact-checking (Stage 3)', 'models'),
  ('agent_model_summarizer',         'qwen/qwen-2.5-72b-instruct:free',       'string', 'Summarizer Model',         'LLM for 60-word summaries (Stage 2)', 'models'),
  ('agent_model_summarizer_fallback','google/gemma-2-9b-it:free',             'string', 'Summarizer Fallback',      'Fallback LLM if summarizer fails', 'models'),
  ('agent_model_post_check',         'meta-llama/llama-3.1-8b-instruct:free', 'string', 'Post-Check Model',         'LLM for post-check verification (Stage 4)', 'models'),
  ('agent_model_deep_dive',          'qwen/qwen-2.5-72b-instruct:free',       'string', 'Deep Dive Primary',        'LLM for deep-dive report generation', 'models'),
  ('agent_model_deep_dive_fallback', 'google/gemma-2-9b-it:free',             'string', 'Deep Dive Fallback',       'Fallback LLM for deep-dive reports', 'models')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  updated_at = now()
WHERE system_config.value LIKE '%deepseek%'
   OR system_config.value LIKE '%gemini%'
   OR system_config.value LIKE '%minimax%'
   OR system_config.value LIKE '%glm%'
   OR system_config.value LIKE '%z-ai%';
-- Only update if using old paid models, keep existing FREE selections

-- Track last OpenRouter sync time
INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('openrouter_last_sync', '', 'string', 'Last Model Sync', 'Timestamp of last OpenRouter model sync', 'system')
ON CONFLICT (key) DO NOTHING;
