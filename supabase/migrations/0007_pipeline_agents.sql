-- ============================================================
-- 0007_pipeline_agents.sql
-- Multi-agent AI pipeline tables + extended model_runs purposes
-- ============================================================

-- Extend model_runs purpose to include pipeline agent stages
ALTER TABLE model_runs DROP CONSTRAINT IF EXISTS model_runs_purpose_check;
ALTER TABLE model_runs
  ADD CONSTRAINT model_runs_purpose_check
  CHECK (purpose IN ('translate', 'summarize', 'relevance_filter', 'fact_check', 'post_check'));

-- Pipeline telemetry: tracks per-article progress through all agent stages
CREATE TABLE pipeline_telemetry (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id          text        NOT NULL REFERENCES normalized_articles(id) ON DELETE CASCADE,

  -- Stage 1: Relevance Filter
  relevance_score     real        NULL,
  relevance_passed    boolean     NOT NULL DEFAULT FALSE,
  relevance_reason    text        NULL,

  -- Stage 2: Fact Checker
  fact_score          real        NULL,
  fact_verdict        text        NULL CHECK (fact_verdict IN ('pass', 'review', 'reject', 'skipped')),
  fact_reason         text        NULL,

  -- Stage 3: Post-Check Verifier
  post_check_passed   boolean     NULL,
  post_check_score    real        NULL,
  post_check_issues   text[]      NULL,

  -- Overall result
  published           boolean     NOT NULL DEFAULT FALSE,
  rejection_reason    text        NULL,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (article_id)
);

CREATE INDEX idx_pipeline_telemetry_article     ON pipeline_telemetry(article_id);
CREATE INDEX idx_pipeline_telemetry_published   ON pipeline_telemetry(published, created_at DESC);
CREATE INDEX idx_pipeline_telemetry_fact_verdict ON pipeline_telemetry(fact_verdict, created_at DESC);

-- Review queue: articles flagged for manual/secondary review
CREATE TABLE review_queue (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  text        NOT NULL REFERENCES normalized_articles(id) ON DELETE CASCADE,
  reason      text        NOT NULL,
  fact_score  real        NULL,
  headline    text        NOT NULL,
  summary60   text        NULL,
  status      text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (article_id)
);

CREATE INDEX idx_review_queue_status ON review_queue(status, created_at DESC);
