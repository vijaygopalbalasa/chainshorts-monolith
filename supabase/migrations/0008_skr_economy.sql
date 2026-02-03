-- ============================================================
-- 0008_skr_economy.sql
-- SKR economy, opinion polls, streaks, and reputation
-- ============================================================

create table if not exists wallet_skr_snapshots (
  wallet text primary key,
  balance_skr numeric(30, 9) not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table if exists feed_items
  add column if not exists card_type text not null default 'news'
    check (card_type in ('news', 'alpha', 'threat', 'opinion', 'report'));

alter table if exists feed_items
  add column if not exists token_context jsonb;

create table if not exists wallet_daily_checkins (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  checkin_date date not null,
  points_awarded integer not null default 0,
  created_at timestamptz not null default now(),
  unique (wallet, checkin_date)
);

create table if not exists wallet_streaks (
  wallet text primary key,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  last_checkin_date date,
  total_points integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists chainrep_events (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  event_type text not null check (
    event_type in (
      'daily_checkin',
      'streak_bonus',
      'opinion_correct',
      'alert_confirmed',
      'manual_adjustment'
    )
  ),
  points_delta integer not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chainrep_events_wallet_created
  on chainrep_events (wallet, created_at desc);

create table if not exists chainrep_scores (
  wallet text primary key,
  total_score integer not null default 0,
  reading_consistency integer not null default 0,
  opinion_accuracy integer not null default 0,
  community_trust integer not null default 0,
  skr_commitment integer not null default 0,
  wallet_history integer not null default 0,
  rank_bucket text not null default 'unranked',
  updated_at timestamptz not null default now()
);

create table if not exists opinion_polls (
  id text primary key,
  question text not null,
  article_context text,
  yes_votes integer not null default 0 check (yes_votes >= 0),
  no_votes integer not null default 0 check (no_votes >= 0),
  total_votes integer not null default 0 check (total_votes >= 0),
  deadline_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'resolved', 'cancelled')),
  resolved_outcome text check (resolved_outcome in ('yes', 'no')),
  resolution_source text,
  resolution_rule jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_opinion_polls_status_deadline
  on opinion_polls (status, deadline_at asc);

create table if not exists opinion_votes (
  id uuid primary key default gen_random_uuid(),
  opinion_id text not null references opinion_polls(id) on delete cascade,
  wallet text not null,
  side text not null check (side in ('yes', 'no')),
  created_at timestamptz not null default now(),
  unique (opinion_id, wallet)
);

create index if not exists idx_opinion_votes_wallet_created
  on opinion_votes (wallet, created_at desc);

create index if not exists idx_opinion_votes_opinion
  on opinion_votes (opinion_id, created_at desc);

create table if not exists opinion_resolutions (
  id uuid primary key default gen_random_uuid(),
  opinion_id text not null unique references opinion_polls(id) on delete cascade,
  resolved_outcome text not null check (resolved_outcome in ('yes', 'no')),
  source text not null,
  evidence jsonb,
  resolved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists custody_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  direction text not null check (direction in ('inbound', 'outbound', 'fee')),
  amount_skr bigint not null check (amount_skr >= 0),
  reference_type text not null check (
    reference_type in ('service_payment', 'manual_adjustment', 'contributor_stake_lock', 'contributor_stake_release')
  ),
  reference_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_custody_ledger_wallet_created
  on custody_ledger (wallet, created_at desc);

create table if not exists service_payments (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  service_type text not null check (
    service_type in ('deep_dive_report', 'content_boost', 'contributor_stake', 'custom_alert_subscription')
  ),
  amount_skr bigint not null check (amount_skr >= 0),
  status text not null default 'completed' check (status in ('completed', 'pending', 'failed')),
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_service_payments_wallet_created
  on service_payments (wallet, created_at desc);
