-- ============================================================
-- 0026_rls_hardening.sql
-- Close legacy permissive RLS gaps and lock down newer tables.
-- API uses service_role and bypasses RLS.
-- ============================================================

-- Remove permissive legacy policies created in 0001.
alter table if exists wallet_links enable row level security;
drop policy if exists "read_own_wallet_links" on wallet_links;
drop policy if exists "wallet_links_deny_all" on wallet_links;
create policy "wallet_links_deny_all"
  on wallet_links
  as restrictive
  for all
  using (false);

alter table if exists reactions_signed enable row level security;
drop policy if exists "write_reactions" on reactions_signed;
drop policy if exists "reactions_signed_deny_all" on reactions_signed;
create policy "reactions_signed_deny_all"
  on reactions_signed
  as restrictive
  for all
  using (false);

alter table if exists tips enable row level security;
drop policy if exists "write_tips" on tips;
drop policy if exists "tips_deny_all" on tips;
create policy "tips_deny_all"
  on tips
  as restrictive
  for all
  using (false);

-- Lock down admin/observability tables.
alter table if exists source_health_metrics enable row level security;
drop policy if exists "source_health_metrics_deny_all" on source_health_metrics;
create policy "source_health_metrics_deny_all"
  on source_health_metrics
  as restrictive
  for all
  using (false);

alter table if exists admin_audit_log enable row level security;
drop policy if exists "admin_audit_log_deny_all" on admin_audit_log;
create policy "admin_audit_log_deny_all"
  on admin_audit_log
  as restrictive
  for all
  using (false);

-- Lock down advertiser and sponsored-card storage tables.
alter table if exists sponsored_cards enable row level security;
drop policy if exists "sponsored_cards_deny_all" on sponsored_cards;
create policy "sponsored_cards_deny_all"
  on sponsored_cards
  as restrictive
  for all
  using (false);

alter table if exists sponsored_card_events enable row level security;
drop policy if exists "sponsored_card_events_deny_all" on sponsored_card_events;
create policy "sponsored_card_events_deny_all"
  on sponsored_card_events
  as restrictive
  for all
  using (false);

alter table if exists advertiser_accounts enable row level security;
drop policy if exists "advertiser_accounts_deny_all" on advertiser_accounts;
create policy "advertiser_accounts_deny_all"
  on advertiser_accounts
  as restrictive
  for all
  using (false);

alter table if exists advertiser_sessions enable row level security;
drop policy if exists "advertiser_sessions_deny_all" on advertiser_sessions;
create policy "advertiser_sessions_deny_all"
  on advertiser_sessions
  as restrictive
  for all
  using (false);
