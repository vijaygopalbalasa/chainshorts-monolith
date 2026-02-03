-- Migration 0031: Drop unused tables and rename privy_user_id → wallet_address
-- Removes: streaks, chainrep, check-ins, and all tables that were never used in production

-- ── ChainRep / streaks / check-ins ──────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS mv_chainrep_leaderboard CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_opinion_accuracy CASCADE;
DROP TABLE IF EXISTS chainrep_scores CASCADE;
DROP TABLE IF EXISTS chainrep_events CASCADE;
DROP TABLE IF EXISTS wallet_daily_checkins CASCADE;
DROP TABLE IF EXISTS wallet_streaks CASCADE;

-- ── Deep-dive reports (feature removed) ─────────────────────────────────────
DROP TABLE IF EXISTS report_requests CASCADE;
DROP TABLE IF EXISTS deep_dive_reports CASCADE;
DROP TABLE IF EXISTS contributor_profiles CASCADE;

-- ── Tips system (replaced by SKR economy) ────────────────────────────────────
DROP TABLE IF EXISTS tip_sponsorship_quotas CASCADE;
DROP TABLE IF EXISTS tips CASCADE;

-- ── Raw article pipeline (v1 design, never used) ────────────────────────────
DROP TABLE IF EXISTS article_summaries CASCADE;
DROP TABLE IF EXISTS normalized_articles CASCADE;
DROP TABLE IF EXISTS story_clusters CASCADE;
DROP TABLE IF EXISTS raw_articles CASCADE;

-- ── Other unused tables ──────────────────────────────────────────────────────
DROP TABLE IF EXISTS prediction_disputes CASCADE;
DROP TABLE IF EXISTS opinion_resolutions CASCADE;
DROP TABLE IF EXISTS threat_signals CASCADE;
DROP TABLE IF EXISTS source_policies CASCADE;
DROP TABLE IF EXISTS push_tokens CASCADE;
DROP TABLE IF EXISTS wallet_links CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ── Clean up privy_user_id in advertiser_accounts ────────────────────────────
-- wallet_address column already exists. Drop privy_user_id if still present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'advertiser_accounts' AND column_name = 'privy_user_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'advertiser_accounts' AND column_name = 'wallet_address'
    ) THEN
      -- Both columns exist: drop the old one
      ALTER TABLE advertiser_accounts DROP COLUMN privy_user_id;
    ELSE
      -- Only old column exists: rename it
      ALTER TABLE advertiser_accounts RENAME COLUMN privy_user_id TO wallet_address;
    END IF;
  END IF;
END $$;
