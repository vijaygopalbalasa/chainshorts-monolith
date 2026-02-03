-- ============================================================
-- 0011_security_fixes.sql
-- Prevents transaction replay attacks on SKR payments,
-- adds missing indexes for query performance.
-- ============================================================

-- Consumed TX signatures: ensures each Solana transaction hash
-- can only be used once to claim a paid service. The PRIMARY KEY
-- constraint on tx_signature provides the uniqueness guarantee.
create table if not exists consumed_tx_signatures (
  tx_signature text primary key,
  wallet       text not null,
  purpose      text not null check (purpose in ('deep_dive', 'content_boost')),
  consumed_at  timestamptz not null default now()
);

create index if not exists idx_consumed_tx_wallet
  on consumed_tx_signatures (wallet, consumed_at desc);

-- Missing performance indexes identified in audit
create index if not exists idx_feed_items_language
  on feed_items (language);

create index if not exists idx_auth_sessions_wallet
  on auth_sessions (wallet_address, expires_at desc);

create index if not exists idx_opinion_polls_status_created
  on opinion_polls (status, created_at desc, id desc);
