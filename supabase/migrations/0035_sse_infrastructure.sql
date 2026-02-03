-- Migration 0035: SSE Infrastructure for Real-Time Pool Updates
-- Adds PostgreSQL NOTIFY trigger for live odds streaming

BEGIN;

-- Create or replace the trigger function for NOTIFY on pool updates
CREATE OR REPLACE FUNCTION notify_pool_update()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'prediction_pool_update',
    json_build_object(
      'poll_id', NEW.poll_id,
      'yes_pool_skr', NEW.yes_pool_skr,
      'no_pool_skr', NEW.no_pool_skr,
      'yes_stakers', NEW.yes_stakers,
      'no_stakers', NEW.no_stakers,
      'updated_at', NEW.updated_at
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists and recreate
DROP TRIGGER IF EXISTS trg_prediction_pool_notify ON prediction_pools;
CREATE TRIGGER trg_prediction_pool_notify
  AFTER INSERT OR UPDATE ON prediction_pools
  FOR EACH ROW EXECUTE FUNCTION notify_pool_update();

-- Also add a trigger for resolution events (for mobile notifications)
CREATE OR REPLACE FUNCTION notify_prediction_resolved()
RETURNS TRIGGER AS $$
BEGIN
  -- Only notify when status changes to 'resolved'
  IF NEW.status = 'resolved' AND (OLD.status IS NULL OR OLD.status != 'resolved') THEN
    PERFORM pg_notify(
      'prediction_resolved',
      json_build_object(
        'poll_id', NEW.id,
        'resolved_outcome', NEW.resolved_outcome,
        'resolution_source', NEW.resolution_source
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prediction_resolved_notify ON opinion_polls;
CREATE TRIGGER trg_prediction_resolved_notify
  AFTER UPDATE ON opinion_polls
  FOR EACH ROW
  WHEN (NEW.is_prediction = true)
  EXECUTE FUNCTION notify_prediction_resolved();

COMMIT;
