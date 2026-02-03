-- ============================================================
-- 0009_threats.sql
-- Threat alerts, community submissions, and review workflow
-- ============================================================

create table if not exists threat_signals (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  signal_type text not null,
  tx_hash text,
  payload jsonb not null,
  dedup_key text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (dedup_key)
);

create index if not exists idx_threat_signals_observed
  on threat_signals (observed_at desc);

create table if not exists threat_alerts (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('RED', 'ORANGE', 'YELLOW')),
  alert_type text not null check (
    alert_type in (
      'rug_pull',
      'whale_dump',
      'governance_attack',
      'contract_vulnerability',
      'bridge_exploit',
      'community'
    )
  ),
  confidence real not null check (confidence >= 0 and confidence <= 1),
  headline text not null,
  summary_60 text not null,
  recommendation text not null,
  tx_hash text,
  source_url text,
  community_signal integer not null default 0,
  status text not null default 'published' check (status in ('published', 'suppressed', 'queued')),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_threat_alerts_published
  on threat_alerts (status, published_at desc);

create index if not exists idx_threat_alerts_severity
  on threat_alerts (severity, published_at desc);

create table if not exists alert_submissions (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  tx_hash text not null,
  observation text not null,
  confidence real not null check (confidence >= 0 and confidence <= 1),
  status text not null default 'queued' check (status in ('queued', 'approved', 'rejected', 'auto_published')),
  linked_alert_id uuid references threat_alerts(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_note text
);

create index if not exists idx_alert_submissions_wallet
  on alert_submissions (wallet, created_at desc);

create index if not exists idx_alert_submissions_status
  on alert_submissions (status, created_at desc);

create table if not exists alert_votes (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references threat_alerts(id) on delete cascade,
  wallet text not null,
  vote text not null check (vote in ('helpful', 'false_alarm')),
  created_at timestamptz not null default now(),
  unique (alert_id, wallet)
);

create index if not exists idx_alert_votes_alert
  on alert_votes (alert_id, created_at desc);

create table if not exists alert_review_log (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid references threat_alerts(id) on delete cascade,
  submission_id uuid references alert_submissions(id) on delete cascade,
  action text not null check (action in ('auto_publish', 'auto_suppress', 'manual_approve', 'manual_reject')),
  actor text not null default 'system',
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_alert_review_log_created
  on alert_review_log (created_at desc);

create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  wallet text,
  device_id text not null,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  locale text,
  app_version text,
  disabled_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (device_id, expo_push_token)
);

create index if not exists idx_push_tokens_wallet_updated
  on push_tokens (wallet, updated_at desc);
