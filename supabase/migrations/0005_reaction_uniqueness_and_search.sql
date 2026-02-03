create extension if not exists pg_trgm;

delete from reactions_signed rs
using (
  select id
  from (
    select
      id,
      row_number() over (
        partition by article_id, wallet
        order by created_at asc, id asc
      ) as row_num
    from reactions_signed
  ) ranked
  where ranked.row_num > 1
) duplicates
where rs.id = duplicates.id;

create unique index if not exists idx_reactions_one_per_wallet_article
  on reactions_signed (article_id, wallet);

create index if not exists idx_feed_items_headline_trgm
  on feed_items using gin (headline gin_trgm_ops);

create index if not exists idx_feed_items_summary_trgm
  on feed_items using gin (summary_60 gin_trgm_ops);
