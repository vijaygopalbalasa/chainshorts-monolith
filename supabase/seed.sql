insert into sources (id, name, homepage_url, feed_url, language_hint)
values
  ('src_coindesk', 'CoinDesk', 'https://www.coindesk.com', 'https://www.coindesk.com/arc/outboundfeeds/rss', 'en'),
  ('src_decrypt', 'Decrypt', 'https://decrypt.co', 'https://decrypt.co/feed', 'en')
on conflict (id) do nothing;

insert into source_policies (source_id, terms_url, allows_summary, allows_headline, allows_image, requires_link_back, ingest_type, active, robots_checked_at)
values
  ('src_coindesk', 'https://www.coindesk.com/terms', true, true, true, true, 'rss', true, now()),
  ('src_decrypt', 'https://decrypt.co/terms', true, true, true, true, 'rss', true, now())
on conflict (source_id) do nothing;

insert into story_clusters (id, representative_headline)
values ('cluster_seed_01', 'Seed headline')
on conflict (id) do nothing;

insert into normalized_articles (id, source_id, canonical_url, headline, original_language, translated_body, image_url, published_at, dedup_hash, cluster_id)
values (
  'norm_seed_01',
  'src_coindesk',
  'https://example.com/seed-article',
  'Chainshorts Seed Story',
  'en',
  'Seed body content for initial environment checks.',
  'https://images.unsplash.com/photo-1639762681485-074b7f938ba0',
  now(),
  'seedhash01',
  'cluster_seed_01'
)
on conflict (id) do nothing;

insert into article_summaries (normalized_article_id, summary_60, model, provider)
values (
  'norm_seed_01',
  'Chainshorts launches with a strict 60-word format for Web3 news. The platform aggregates compliant source feeds, removes duplicates, and produces concise English summaries with source attribution. Solana wallet login enables verified reactions and optional tipping actions. The feed prioritizes chronological clarity, source diversity, and transparent link-out behavior for deeper reading across global crypto ecosystems daily.',
  'seed-model',
  'seed-provider'
)
on conflict (normalized_article_id) do nothing;

insert into feed_items (id, normalized_article_id, headline, summary_60, image_url, source_name, source_url, published_at, cluster_id, language, category)
values (
  'norm_seed_01',
  'norm_seed_01',
  'Chainshorts Seed Story',
  'Chainshorts launches with a strict 60-word format for Web3 news. The platform aggregates compliant source feeds, removes duplicates, and produces concise English summaries with source attribution. Solana wallet login enables verified reactions and optional tipping actions. The feed prioritizes chronological clarity, source diversity, and transparent link-out behavior for deeper reading across global crypto ecosystems daily.',
  'https://images.unsplash.com/photo-1639762681485-074b7f938ba0',
  'CoinDesk',
  'https://example.com/seed-article',
  now(),
  'cluster_seed_01',
  'en',
  'web3'
)
on conflict (id) do nothing;
