create table if not exists api_rate_limit_buckets (
  bucket text not null,
  scope text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  count integer not null default 0,
  primary key (bucket, scope, window_start)
);

create index if not exists idx_api_rate_limit_window_end
  on api_rate_limit_buckets (window_end);

