create table if not exists bookmarks (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  article_id text not null references feed_items(id) on delete cascade,
  bookmarked_at timestamptz not null default now(),
  unique (wallet, article_id)
);

create index if not exists idx_bookmarks_wallet_order
  on bookmarks (wallet, bookmarked_at desc, article_id desc);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  wallet_address text,
  locale text,
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  unique (device_id, expo_push_token)
);

create index if not exists idx_push_subscriptions_active
  on push_subscriptions (disabled_at, updated_at desc);

create index if not exists idx_reactions_signed_article_type
  on reactions_signed (article_id, reaction_type);

create index if not exists idx_tips_leaderboard_window
  on tips (submitted, submitted_at desc, wallet);

create index if not exists idx_auth_challenges_expiry
  on auth_challenges (expires_at);

create index if not exists idx_auth_sessions_expiry
  on auth_sessions (expires_at, invalidated_at);
