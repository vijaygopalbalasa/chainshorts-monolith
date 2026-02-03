-- Migration: Admin Observability + Source Health Tracking
-- Created: 2026-02-23
-- Purpose: Comprehensive admin dashboard metrics, source health monitoring, audit logging

-- ============================================================================
-- SOURCE HEALTH METRICS
-- Track per-source RSS fetch success/failure rates for observability
-- ============================================================================

CREATE TABLE IF NOT EXISTS source_health_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  fetch_success boolean NOT NULL,
  fetch_latency_ms integer,
  articles_found integer NOT NULL DEFAULT 0,
  articles_published integer NOT NULL DEFAULT 0,
  error_message text,
  http_status integer
);

-- Index for per-source health history queries
CREATE INDEX IF NOT EXISTS idx_source_health_source_time
  ON source_health_metrics(source_id, checked_at DESC);

-- Index for overall health dashboard queries
CREATE INDEX IF NOT EXISTS idx_source_health_time
  ON source_health_metrics(checked_at DESC);

-- Cleanup old health metrics (older than 30 days) - optional scheduled job
-- DELETE FROM source_health_metrics WHERE checked_at < now() - interval '30 days';

-- ============================================================================
-- ADMIN AUDIT LOG
-- Track all admin panel actions for accountability
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,                     -- e.g., 'config_update', 'source_toggle', 'model_change'
  actor text NOT NULL DEFAULT 'admin',      -- wallet address or 'system'
  target_type text NOT NULL,                -- e.g., 'system_config', 'source', 'prediction'
  target_id text,                           -- ID of affected entity
  old_value text,                           -- Previous value (JSON stringified)
  new_value text,                           -- New value (JSON stringified)
  metadata jsonb,                           -- Additional context
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_time
  ON admin_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_action
  ON admin_audit_log(action, created_at DESC);

-- ============================================================================
-- NEW SYSTEM CONFIG KEYS FOR DYNAMIC SOURCES
-- ============================================================================

INSERT INTO system_config (key, value, value_type, label, description, category) VALUES
  ('sources_dynamic_enabled', 'true', 'boolean', 'Dynamic Sources', 'Load sources from database instead of hardcoded registry', 'sources'),
  ('source_health_interval', '300', 'integer', 'Health Check Interval', 'Seconds between source health metric recordings', 'sources'),
  ('source_health_retention_days', '30', 'integer', 'Health Retention Days', 'Days to keep source health metrics before cleanup', 'sources')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- PIPELINE TELEMETRY IMPROVEMENTS
-- Add missing indexes for admin dashboard queries
-- ============================================================================

-- Index for daily article counts
CREATE INDEX IF NOT EXISTS idx_pipeline_telemetry_created_published
  ON pipeline_telemetry(created_at DESC, published);

-- Index for rejection reason analysis
CREATE INDEX IF NOT EXISTS idx_pipeline_telemetry_rejection
  ON pipeline_telemetry(rejection_reason, created_at DESC)
  WHERE rejection_reason IS NOT NULL;

-- ============================================================================
-- MODEL RUNS IMPROVEMENTS
-- Better indexing for cost analysis
-- ============================================================================

-- Index for per-model cost queries
CREATE INDEX IF NOT EXISTS idx_model_runs_model_time
  ON model_runs(model, created_at DESC);

-- Index for per-purpose queries
CREATE INDEX IF NOT EXISTS idx_model_runs_purpose_time
  ON model_runs(purpose, created_at DESC);

-- ============================================================================
-- SOURCES TABLE IMPROVEMENTS
-- Add columns for dynamic source management
-- ============================================================================

-- Add soft-delete support for sources
ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Add last successful fetch timestamp for quick health check
ALTER TABLE source_policies
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz;

-- Add consecutive failure count for alerting
ALTER TABLE source_policies
  ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;

-- ============================================================================
-- REVIEW QUEUE IMPROVEMENTS
-- Add reviewed_at and reviewed_by for audit trail
-- ============================================================================

ALTER TABLE review_queue
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE review_queue
  ADD COLUMN IF NOT EXISTS reviewed_by text;

-- Index for pending reviews dashboard count
CREATE INDEX IF NOT EXISTS idx_review_queue_pending
  ON review_queue(status, created_at DESC)
  WHERE status = 'pending';
