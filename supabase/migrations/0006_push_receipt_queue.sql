create table if not exists push_receipts_pending (
  receipt_id text primary key,
  expo_push_token text not null,
  available_after timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_receipts_pending_due
  on push_receipts_pending (available_after, attempts);
