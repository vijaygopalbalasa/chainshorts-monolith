-- 0013_system_config.sql
-- Admin-controllable key-value config. Ingest worker polls every 60s;
-- API reads with a 30s in-memory cache. Setting ai_enabled='false' stops
-- ALL OpenRouter LLM calls within one polling cycle.

create table system_config (
  key          text primary key,
  value        text        not null,
  value_type   text        not null default 'string'
                           check (value_type in ('boolean','integer','float','string')),
  label        text        not null,
  description  text,
  category     text        not null,
  updated_at   timestamptz not null default now(),
  updated_by   text        not null default 'system'
);

-- ── Pipeline master & per-stage toggles ─────────────────────────────────────
insert into system_config (key, value, value_type, label, description, category) values
('ai_enabled',               'false', 'boolean', 'AI Processing (Master Switch)', 'Pause ALL OpenRouter API calls instantly', 'pipeline'),
('ingest_enabled',           'true',  'boolean', 'Ingest Pipeline',               'Enable/disable article ingestion entirely', 'ingest'),
('relevance_filter_enabled', 'true',  'boolean', 'Relevance Filter (Stage 1)',    'Stage 1 — filter irrelevant articles', 'pipeline'),
('fact_checker_enabled',     'false', 'boolean', 'Fact Checker (Stage 3)',        'Stage 3 — web-search fact-check (most expensive stage)', 'pipeline'),
('post_check_enabled',       'true',  'boolean', 'Post-Check Verifier (Stage 4)', 'Stage 4 — final alignment check before publish', 'pipeline'),

-- ── Model selection ──────────────────────────────────────────────────────────
('agent_model_summarizer',   'google/gemini-2.0-flash-001',     'string', 'Summarizer Model',       'LLM used for 60-word summaries (Stage 2)', 'models'),
('agent_model_fact_checker', 'google/gemini-2.5-flash-preview',  'string', 'Fact Checker Model',     'LLM used for fact-checking (Stage 3)', 'models'),
('agent_model_relevance',    'deepseek/deepseek-v3.2',           'string', 'Relevance Filter Model', 'LLM used for relevance scoring (Stage 1)', 'models'),
('agent_model_post_check',   'z-ai/glm-5',                       'string', 'Post-Check Model',       'LLM used for post-check verification (Stage 4)', 'models'),

-- ── Decision thresholds ──────────────────────────────────────────────────────
('fact_check_auto_publish',  '0.70',  'float',   'Auto-Publish Threshold',    'Auto-publish articles with fact score >= this value (0.0–1.0)', 'pipeline'),
('fact_check_review',        '0.55',  'float',   'Review Queue Threshold',    'Route to review queue if fact score >= this value (0.0–1.0)', 'pipeline'),

-- ── Ingest tuning ────────────────────────────────────────────────────────────
('trending_min_sources',     '2',     'integer', 'Trending Min Sources',      'Minimum sources covering same story to flag as trending', 'ingest'),
('max_articles_per_run',     '15',    'integer', 'Max Articles Per Run',      'Maximum articles processed per ingest cycle per source', 'ingest'),

-- ── Feature toggles ──────────────────────────────────────────────────────────
('push_notifications_enabled', 'true', 'boolean', 'Push Notifications',      'Broadcast push notifications after new articles are published', 'features'),
('deep_dive_reports_enabled',  'true', 'boolean', 'Deep Dive Reports',       'Enable AI deep-dive report generation endpoint', 'features'),
('opinion_polls_enabled',      'true', 'boolean', 'Opinion Polls',           'Enable auto-generated opinion poll creation', 'features'),
('threat_alerts_enabled',      'true', 'boolean', 'Threat Alerts',           'Enable Helius-based threat alert detection and publishing', 'features');
