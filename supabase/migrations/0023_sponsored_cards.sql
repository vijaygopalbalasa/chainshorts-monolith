-- Migration 0023: Sponsored feed cards (Inshorts-style ads)

create table if not exists sponsored_cards (
  id               uuid        primary key default gen_random_uuid(),
  advertiser_name  text        not null,
  headline         text        not null,
  body_text        text        not null,
  image_url        text,
  destination_url  text        not null,
  cta_text         text        not null default 'Learn More',
  accent_color     text        not null default '#14F195',
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz not null,
  impression_limit integer,
  impression_count integer     not null default 0,
  click_count      integer     not null default 0,
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now()
);

create index on sponsored_cards (is_active, starts_at, ends_at);

create table if not exists sponsored_card_events (
  id         uuid        primary key default gen_random_uuid(),
  card_id    uuid        not null references sponsored_cards(id) on delete cascade,
  event_type text        not null check (event_type in ('impression', 'click')),
  created_at timestamptz not null default now()
);

create index on sponsored_card_events (card_id, event_type, created_at desc);
