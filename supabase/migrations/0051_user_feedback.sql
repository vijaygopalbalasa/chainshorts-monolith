BEGIN;

CREATE TABLE IF NOT EXISTS user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bug', 'suggestion', 'other')),
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 100),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 5 AND 1000),
  app_version TEXT,
  platform TEXT CHECK (platform IN ('android', 'ios', 'web')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'resolved')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_feedback_created_at_idx
  ON user_feedback (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS user_feedback_status_idx
  ON user_feedback (status, created_at DESC);

ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_feedback'
      AND policyname = 'user_feedback_deny_all'
  ) THEN
    CREATE POLICY user_feedback_deny_all
      ON user_feedback
      AS RESTRICTIVE
      FOR ALL
      USING (false);
  END IF;
END $$;

COMMIT;
