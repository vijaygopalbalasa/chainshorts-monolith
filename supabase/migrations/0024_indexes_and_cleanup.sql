-- Migration 0024: Add missing performance index on content_boosts
-- Fixes full table scan on feed query LEFT JOIN content_boosts

CREATE INDEX IF NOT EXISTS idx_content_boosts_content_id_status
  ON content_boosts (content_id, status)
  WHERE status = 'active';
