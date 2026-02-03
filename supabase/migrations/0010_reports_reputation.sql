-- ============================================================
-- 0010_reports_reputation.sql
-- Deep-dive reports, boosts, contributor profile, and leaderboards
-- ============================================================

alter table model_runs drop constraint if exists model_runs_purpose_check;
alter table model_runs
  add constraint model_runs_purpose_check
  check (
    purpose in (
      'translate',
      'summarize',
      'relevance_filter',
      'fact_check',
      'post_check',
      'trend_detect',
      'threat_classify',
      'opinion_resolve',
      'deep_dive_report'
    )
  );

create table if not exists report_requests (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  project text not null,
  payment_mode text not null check (payment_mode in ('skr_payg', 'tier_pro')),
  status text not null default 'queued' check (status in ('queued', 'completed', 'failed')),
  report_id uuid,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_report_requests_wallet_created
  on report_requests (wallet, created_at desc);

create table if not exists deep_dive_reports (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  project text not null,
  payment_mode text not null check (payment_mode in ('skr_payg', 'tier_pro')),
  risk_score integer not null check (risk_score between 1 and 10),
  verdict text not null check (verdict in ('watch', 'investigate', 'caution')),
  summary_60 text not null,
  content text not null,
  sections jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_deep_dive_reports_wallet_created
  on deep_dive_reports (wallet, created_at desc);

create table if not exists contributor_profiles (
  wallet text primary key,
  verified boolean not null default false,
  staked_skr bigint not null default 0,
  chainrep_at_verification integer,
  updated_at timestamptz not null default now()
);

create table if not exists content_boosts (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  content_id text not null,
  duration_days integer not null check (duration_days between 1 and 30),
  amount_skr bigint not null check (amount_skr > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists idx_content_boosts_content_active
  on content_boosts (content_id, status, ends_at desc);

create index if not exists idx_content_boosts_wallet_created
  on content_boosts (wallet, created_at desc);

drop materialized view if exists mv_chainrep_leaderboard;
create materialized view mv_chainrep_leaderboard as
select
  cs.wallet,
  cs.total_score,
  cs.rank_bucket,
  cs.updated_at
from chainrep_scores cs
order by cs.total_score desc, cs.updated_at desc;

create unique index if not exists idx_mv_chainrep_leaderboard_wallet
  on mv_chainrep_leaderboard (wallet);

create index if not exists idx_mv_chainrep_leaderboard_rank
  on mv_chainrep_leaderboard (total_score desc);

drop materialized view if exists mv_opinion_accuracy;
create materialized view mv_opinion_accuracy as
select
  ov.wallet,
  count(*) filter (where op.status = 'resolved' and op.resolved_outcome is not null)::int as total_resolved,
  count(*) filter (where op.status = 'resolved' and op.resolved_outcome is not null and ov.side = op.resolved_outcome)::int as total_correct,
  case
    when count(*) filter (where op.status = 'resolved' and op.resolved_outcome is not null) = 0 then 0
    else round(
      (
        count(*) filter (where op.status = 'resolved' and op.resolved_outcome is not null and ov.side = op.resolved_outcome)::numeric
        / count(*) filter (where op.status = 'resolved' and op.resolved_outcome is not null)::numeric
      ) * 100
    )::int
  end as accuracy_pct
from opinion_votes ov
join opinion_polls op on op.id = ov.opinion_id
group by ov.wallet;

create unique index if not exists idx_mv_opinion_accuracy_wallet
  on mv_opinion_accuracy (wallet);
