-- ============================================================
-- 0012_rls_policies.sql
-- Enables Row Level Security on all sensitive tables so that
-- direct Supabase client access cannot read other users' data.
-- The API server uses the service_role key which bypasses RLS.
-- ============================================================

-- ── auth_sessions ────────────────────────────────────────────
-- Only the session owner can read their own sessions.
alter table if exists auth_sessions enable row level security;

drop policy if exists "auth_sessions_deny_all" on auth_sessions;
create policy "auth_sessions_deny_all"
  on auth_sessions
  as restrictive
  for all
  using (false);

-- ── auth_challenges ──────────────────────────────────────────
alter table if exists auth_challenges enable row level security;

drop policy if exists "auth_challenges_deny_all" on auth_challenges;
create policy "auth_challenges_deny_all"
  on auth_challenges
  as restrictive
  for all
  using (false);

-- ── consumed_tx_signatures ───────────────────────────────────
-- Replay-prevention log — must never be readable by clients.
alter table if exists consumed_tx_signatures enable row level security;

drop policy if exists "consumed_tx_deny_all" on consumed_tx_signatures;
create policy "consumed_tx_deny_all"
  on consumed_tx_signatures
  as restrictive
  for all
  using (false);

-- ── deep_dive_reports ────────────────────────────────────────
-- Reports are private to the wallet that generated them.
alter table if exists deep_dive_reports enable row level security;

drop policy if exists "deep_dive_reports_deny_all" on deep_dive_reports;
create policy "deep_dive_reports_deny_all"
  on deep_dive_reports
  as restrictive
  for all
  using (false);

-- ── bookmarks ────────────────────────────────────────────────
alter table if exists bookmarks enable row level security;

drop policy if exists "bookmarks_deny_all" on bookmarks;
create policy "bookmarks_deny_all"
  on bookmarks
  as restrictive
  for all
  using (false);

-- ── push_subscriptions ───────────────────────────────────────
-- Push tokens are PII; deny direct client access.
alter table if exists push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_deny_all" on push_subscriptions;
create policy "push_subscriptions_deny_all"
  on push_subscriptions
  as restrictive
  for all
  using (false);

-- ── wallet_skr_snapshots ─────────────────────────────────────
alter table if exists wallet_skr_snapshots enable row level security;

drop policy if exists "skr_snapshots_deny_all" on wallet_skr_snapshots;
create policy "skr_snapshots_deny_all"
  on wallet_skr_snapshots
  as restrictive
  for all
  using (false);

-- ── wallet_streaks ───────────────────────────────────────────
alter table if exists wallet_streaks enable row level security;

drop policy if exists "wallet_streaks_deny_all" on wallet_streaks;
create policy "wallet_streaks_deny_all"
  on wallet_streaks
  as restrictive
  for all
  using (false);

-- ── chainrep_scores ──────────────────────────────────────────
-- Reputation scores are readable publicly via API; deny raw client access.
alter table if exists chainrep_scores enable row level security;

drop policy if exists "chainrep_scores_deny_all" on chainrep_scores;
create policy "chainrep_scores_deny_all"
  on chainrep_scores
  as restrictive
  for all
  using (false);

-- ── chainrep_events ──────────────────────────────────────────
alter table if exists chainrep_events enable row level security;

drop policy if exists "chainrep_events_deny_all" on chainrep_events;
create policy "chainrep_events_deny_all"
  on chainrep_events
  as restrictive
  for all
  using (false);

-- ── opinion_votes ────────────────────────────────────────────
-- Vote history is private; only exposed via authenticated API.
alter table if exists opinion_votes enable row level security;

drop policy if exists "opinion_votes_deny_all" on opinion_votes;
create policy "opinion_votes_deny_all"
  on opinion_votes
  as restrictive
  for all
  using (false);

-- ── alert_submissions ────────────────────────────────────────
alter table if exists alert_submissions enable row level security;

drop policy if exists "alert_submissions_deny_all" on alert_submissions;
create policy "alert_submissions_deny_all"
  on alert_submissions
  as restrictive
  for all
  using (false);

-- ── alert_votes ──────────────────────────────────────────────
alter table if exists alert_votes enable row level security;

drop policy if exists "alert_votes_deny_all" on alert_votes;
create policy "alert_votes_deny_all"
  on alert_votes
  as restrictive
  for all
  using (false);

-- ── content_boosts ───────────────────────────────────────────
alter table if exists content_boosts enable row level security;

drop policy if exists "content_boosts_deny_all" on content_boosts;
create policy "content_boosts_deny_all"
  on content_boosts
  as restrictive
  for all
  using (false);

-- ── service_payments ─────────────────────────────────────────
alter table if exists service_payments enable row level security;

drop policy if exists "service_payments_deny_all" on service_payments;
create policy "service_payments_deny_all"
  on service_payments
  as restrictive
  for all
  using (false);

-- ── tips / tip_sponsorship_quotas ────────────────────────────
-- Tips table kept for backward compatibility (old data); deny access.
alter table if exists tips enable row level security;

drop policy if exists "tips_deny_all" on tips;
create policy "tips_deny_all"
  on tips
  as restrictive
  for all
  using (false);

alter table if exists tip_sponsorship_quotas enable row level security;

drop policy if exists "tip_quotas_deny_all" on tip_sponsorship_quotas;
create policy "tip_quotas_deny_all"
  on tip_sponsorship_quotas
  as restrictive
  for all
  using (false);

-- ── api_rate_limit_buckets ───────────────────────────────────
alter table if exists api_rate_limit_buckets enable row level security;

drop policy if exists "rate_limit_deny_all" on api_rate_limit_buckets;
create policy "rate_limit_deny_all"
  on api_rate_limit_buckets
  as restrictive
  for all
  using (false);

-- ── pipeline_telemetry / review_queue ────────────────────────
alter table if exists pipeline_telemetry enable row level security;

drop policy if exists "pipeline_telemetry_deny_all" on pipeline_telemetry;
create policy "pipeline_telemetry_deny_all"
  on pipeline_telemetry
  as restrictive
  for all
  using (false);

alter table if exists review_queue enable row level security;

drop policy if exists "review_queue_deny_all" on review_queue;
create policy "review_queue_deny_all"
  on review_queue
  as restrictive
  for all
  using (false);
