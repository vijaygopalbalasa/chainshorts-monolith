-- ============================================================
-- 0014_prediction_markets.sql
-- Polymarket-style prediction markets: stake SKR on poll outcomes
-- Winners split losers' pool minus platform fee (5%)
-- ============================================================

-- ── Extend opinion_polls for prediction market support ──────────────────────
alter table opinion_polls
  add column if not exists is_prediction boolean not null default false;

alter table opinion_polls
  add column if not exists min_stake_skr integer not null default 10;

alter table opinion_polls
  add column if not exists max_stake_skr integer not null default 10000;

alter table opinion_polls
  add column if not exists platform_fee_pct numeric(5, 2) not null default 5.00;

-- ── Individual stakes (replaces simple votes for predictions) ───────────────
create table if not exists prediction_stakes (
  id uuid primary key default gen_random_uuid(),
  poll_id text not null references opinion_polls(id) on delete cascade,
  wallet text not null,
  side text not null check (side in ('yes', 'no')),
  amount_skr bigint not null check (amount_skr > 0),
  tx_signature text not null,
  status text not null default 'active' check (
    status in ('active', 'won', 'lost', 'cancelled', 'claimed')
  ),
  payout_skr bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_prediction_stakes_poll_side
  on prediction_stakes (poll_id, side, status);

create index if not exists idx_prediction_stakes_wallet_created
  on prediction_stakes (wallet, created_at desc);

create index if not exists idx_prediction_stakes_tx
  on prediction_stakes (tx_signature);

-- ── Aggregated pool stats (updated on each stake) ───────────────────────────
create table if not exists prediction_pools (
  poll_id text primary key references opinion_polls(id) on delete cascade,
  yes_pool_skr bigint not null default 0 check (yes_pool_skr >= 0),
  no_pool_skr bigint not null default 0 check (no_pool_skr >= 0),
  total_pool_skr bigint generated always as (yes_pool_skr + no_pool_skr) stored,
  yes_stakers integer not null default 0 check (yes_stakers >= 0),
  no_stakers integer not null default 0 check (no_stakers >= 0),
  total_stakers integer generated always as (yes_stakers + no_stakers) stored,
  updated_at timestamptz not null default now()
);

-- ── Payout records (created on settlement) ──────────────────────────────────
create table if not exists prediction_payouts (
  id uuid primary key default gen_random_uuid(),
  poll_id text not null references opinion_polls(id) on delete cascade,
  wallet text not null,
  stake_id uuid not null references prediction_stakes(id) on delete cascade,
  stake_skr bigint not null,
  winnings_skr bigint not null,
  platform_fee_skr bigint not null,
  net_payout_skr bigint not null,
  payout_ratio numeric(10, 4) not null,
  status text not null default 'pending' check (
    status in ('pending', 'claimed', 'expired')
  ),
  claim_deadline timestamptz not null default (now() + interval '30 days'),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_prediction_payouts_wallet_status
  on prediction_payouts (wallet, status, created_at desc);

create index if not exists idx_prediction_payouts_poll
  on prediction_payouts (poll_id, created_at desc);

-- ── Platform fee collection ledger ──────────────────────────────────────────
create table if not exists prediction_platform_fees (
  id uuid primary key default gen_random_uuid(),
  poll_id text not null references opinion_polls(id) on delete cascade,
  total_fee_skr bigint not null check (total_fee_skr >= 0),
  collected_at timestamptz not null default now()
);

-- ── Disputes (optional: users can dispute resolution) ───────────────────────
create table if not exists prediction_disputes (
  id uuid primary key default gen_random_uuid(),
  poll_id text not null references opinion_polls(id) on delete cascade,
  wallet text not null,
  reason text not null,
  status text not null default 'pending' check (
    status in ('pending', 'investigating', 'resolved', 'rejected')
  ),
  resolution_note text,
  resolved_by text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (poll_id, wallet)
);

create index if not exists idx_prediction_disputes_status
  on prediction_disputes (status, created_at desc);

-- ── Extend consumed_tx_signatures for prediction stakes ─────────────────────
alter table consumed_tx_signatures
  drop constraint if exists consumed_tx_signatures_purpose_check;

alter table consumed_tx_signatures
  add constraint consumed_tx_signatures_purpose_check
  check (purpose in ('deep_dive', 'content_boost', 'prediction_stake'));

-- ── System config entries for prediction markets ────────────────────────────
insert into system_config (key, value, value_type, label, description, category) values
  ('predictions_enabled', 'false', 'boolean', 'Prediction Markets', 'Enable real-money prediction market staking', 'features'),
  ('prediction_min_stake', '10', 'integer', 'Min Stake (SKR)', 'Minimum SKR amount per prediction stake', 'predictions'),
  ('prediction_max_stake', '10000', 'integer', 'Max Stake (SKR)', 'Maximum SKR amount per prediction stake', 'predictions'),
  ('prediction_daily_limit', '50000', 'integer', 'Daily Limit (SKR)', 'Maximum total SKR a wallet can stake per day', 'predictions'),
  ('prediction_fee_pct', '5.00', 'float', 'Platform Fee %', 'Percentage fee taken from losing pool', 'predictions'),
  ('prediction_claim_days', '30', 'integer', 'Claim Window (Days)', 'Days to claim winnings before expiry', 'predictions')
on conflict (key) do nothing;

-- ── RLS policies (deny all direct access, use API) ──────────────────────────
alter table prediction_stakes enable row level security;
drop policy if exists "prediction_stakes_deny_all" on prediction_stakes;
create policy "prediction_stakes_deny_all"
  on prediction_stakes as restrictive for all using (false);

alter table prediction_pools enable row level security;
drop policy if exists "prediction_pools_deny_all" on prediction_pools;
create policy "prediction_pools_deny_all"
  on prediction_pools as restrictive for all using (false);

alter table prediction_payouts enable row level security;
drop policy if exists "prediction_payouts_deny_all" on prediction_payouts;
create policy "prediction_payouts_deny_all"
  on prediction_payouts as restrictive for all using (false);

alter table prediction_platform_fees enable row level security;
drop policy if exists "prediction_platform_fees_deny_all" on prediction_platform_fees;
create policy "prediction_platform_fees_deny_all"
  on prediction_platform_fees as restrictive for all using (false);

alter table prediction_disputes enable row level security;
drop policy if exists "prediction_disputes_deny_all" on prediction_disputes;
create policy "prediction_disputes_deny_all"
  on prediction_disputes as restrictive for all using (false);
