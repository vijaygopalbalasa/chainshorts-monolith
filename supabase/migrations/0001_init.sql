create extension if not exists "pgcrypto";

create table if not exists sources (
  id text primary key,
  name text not null,
  homepage_url text not null,
  feed_url text not null,
  language_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists source_policies (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique references sources(id) on delete cascade,
  terms_url text,
  allows_summary boolean not null default true,
  allows_headline boolean not null default true,
  allows_image boolean not null default true,
  requires_link_back boolean not null default true,
  ingest_type text not null check (ingest_type in ('rss', 'api', 'sitemap')),
  active boolean not null default true,
  robots_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists raw_articles (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references sources(id) on delete cascade,
  external_id text not null,
  url text not null,
  headline text not null,
  body text,
  language text not null,
  image_url text,
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create table if not exists story_clusters (
  id text primary key,
  representative_headline text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists normalized_articles (
  id text primary key,
  source_id text not null references sources(id) on delete cascade,
  canonical_url text not null,
  headline text not null,
  original_language text not null,
  translated_body text,
  image_url text,
  published_at timestamptz not null,
  dedup_hash text not null unique,
  cluster_id text not null references story_clusters(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists article_summaries (
  id uuid primary key default gen_random_uuid(),
  normalized_article_id text not null unique references normalized_articles(id) on delete cascade,
  summary_60 text not null,
  model text not null,
  provider text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists feed_items (
  id text primary key,
  normalized_article_id text not null unique references normalized_articles(id) on delete cascade,
  headline text not null,
  summary_60 text not null,
  image_url text,
  source_name text not null,
  source_url text not null,
  published_at timestamptz not null,
  cluster_id text not null,
  language text not null default 'en',
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists wallet_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wallet_address text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists auth_challenges (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  nonce text not null,
  message text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (wallet_address, nonce)
);

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  session_token text not null unique,
  wallet_address text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists reactions_signed (
  id uuid primary key default gen_random_uuid(),
  article_id text not null references feed_items(id) on delete cascade,
  wallet text not null,
  reaction_type text not null,
  nonce text not null,
  signature text not null,
  created_at timestamptz not null default now(),
  unique (article_id, wallet, nonce)
);

create table if not exists tips (
  id uuid primary key default gen_random_uuid(),
  quote_id text not null unique,
  wallet text not null,
  article_id text not null references feed_items(id) on delete cascade,
  amount_lamports bigint not null,
  sponsor_mode text not null check (sponsor_mode in ('sponsored', 'user_pays')),
  sponsor_available boolean not null,
  network_fee_lamports bigint not null,
  recipient_wallet text not null,
  transaction_signature text,
  expires_at timestamptz not null,
  submitted boolean not null default false,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists tip_sponsorship_quotas (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  usage_date date not null,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (wallet, usage_date)
);

create table if not exists ingestion_jobs (
  id text primary key,
  job_name text not null,
  status text not null,
  detail text,
  started_at timestamptz not null,
  finished_at timestamptz
);

create table if not exists model_runs (
  id uuid primary key,
  provider text not null,
  model text not null,
  purpose text not null check (purpose in ('translate', 'summarize')),
  input_tokens integer,
  output_tokens integer,
  latency_ms integer not null,
  success boolean not null,
  error text,
  created_at timestamptz not null
);

create index if not exists idx_feed_items_order on feed_items (published_at desc, id desc);
create index if not exists idx_feed_items_category on feed_items (category, published_at desc);
create index if not exists idx_raw_articles_source_published on raw_articles (source_id, published_at desc);
create index if not exists idx_normalized_articles_cluster on normalized_articles (cluster_id);
create index if not exists idx_tips_wallet_created on tips (wallet, created_at desc);
create index if not exists idx_model_runs_created on model_runs (created_at desc);

alter table reactions_signed enable row level security;
alter table tips enable row level security;
alter table wallet_links enable row level security;

create policy "read_own_wallet_links" on wallet_links
for select using (true);

create policy "write_reactions" on reactions_signed
for insert with check (true);

create policy "write_tips" on tips
for insert with check (true);
