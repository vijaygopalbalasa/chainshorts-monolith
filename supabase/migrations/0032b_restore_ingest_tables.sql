-- Migration 0032: Restore ingest pipeline tables incorrectly dropped in 0031
-- These tables are actively used by workers/ingest and were wrongly marked as "unused"

-- ── Step 1: Recreate story_clusters (no dependencies) ──────────────────────────
CREATE TABLE IF NOT EXISTS story_clusters (
  id TEXT PRIMARY KEY,
  representative_headline TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Step 2: Recreate normalized_articles (depends on story_clusters, sources) ──
CREATE TABLE IF NOT EXISTS normalized_articles (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  canonical_url TEXT NOT NULL,
  headline TEXT NOT NULL,
  original_language TEXT NOT NULL,
  translated_body TEXT,
  image_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  dedup_hash TEXT NOT NULL UNIQUE,
  cluster_id TEXT NOT NULL REFERENCES story_clusters(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Step 3: Re-add FK from feed_items to normalized_articles ───────────────────
-- The CASCADE drop removed this FK constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'feed_items_normalized_article_id_fkey'
      AND table_name = 'feed_items'
  ) THEN
    -- Only add FK if it doesn't exist (may have orphaned rows, so make it deferrable)
    ALTER TABLE feed_items
      ADD CONSTRAINT feed_items_normalized_article_id_fkey
      FOREIGN KEY (normalized_article_id) REFERENCES normalized_articles(id)
      ON DELETE CASCADE
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
EXCEPTION WHEN foreign_key_violation THEN
  -- If there are orphaned rows, skip the FK constraint (data integrity issue from 0031)
  RAISE WARNING 'Cannot add FK constraint due to orphaned feed_items rows';
END $$;

-- ── Step 4: Recreate article_summaries (depends on normalized_articles) ────────
CREATE TABLE IF NOT EXISTS article_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_article_id TEXT NOT NULL UNIQUE REFERENCES normalized_articles(id) ON DELETE CASCADE,
  summary_60 TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Step 5: Recreate source_policies (depends on sources) ──────────────────────
CREATE TABLE IF NOT EXISTS source_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL UNIQUE REFERENCES sources(id) ON DELETE CASCADE,
  terms_url TEXT,
  allows_summary BOOLEAN NOT NULL DEFAULT true,
  allows_headline BOOLEAN NOT NULL DEFAULT true,
  allows_image BOOLEAN NOT NULL DEFAULT true,
  requires_link_back BOOLEAN NOT NULL DEFAULT true,
  ingest_type TEXT NOT NULL CHECK (ingest_type IN ('rss', 'api', 'sitemap')),
  active BOOLEAN NOT NULL DEFAULT true,
  robots_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Step 6: Recreate raw_articles (depends on sources) ─────────────────────────
CREATE TABLE IF NOT EXISTS raw_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  url TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT,
  language TEXT NOT NULL,
  image_url TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);

-- ── Step 7: Recreate indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_raw_articles_source_published ON raw_articles (source_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_normalized_articles_cluster ON normalized_articles (cluster_id);

-- ── Step 8: Enable RLS (deny-all pattern for security) ─────────────────────────
ALTER TABLE story_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE normalized_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_clusters_deny_all" ON story_clusters;
DROP POLICY IF EXISTS "normalized_articles_deny_all" ON normalized_articles;
DROP POLICY IF EXISTS "article_summaries_deny_all" ON article_summaries;
DROP POLICY IF EXISTS "source_policies_deny_all" ON source_policies;
DROP POLICY IF EXISTS "raw_articles_deny_all" ON raw_articles;

CREATE POLICY "story_clusters_deny_all" ON story_clusters AS RESTRICTIVE FOR ALL USING (false);
CREATE POLICY "normalized_articles_deny_all" ON normalized_articles AS RESTRICTIVE FOR ALL USING (false);
CREATE POLICY "article_summaries_deny_all" ON article_summaries AS RESTRICTIVE FOR ALL USING (false);
CREATE POLICY "source_policies_deny_all" ON source_policies AS RESTRICTIVE FOR ALL USING (false);
CREATE POLICY "raw_articles_deny_all" ON raw_articles AS RESTRICTIVE FOR ALL USING (false);
