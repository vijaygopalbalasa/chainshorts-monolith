alter table if exists auth_sessions
  add column if not exists invalidated_at timestamptz;

create index if not exists idx_auth_sessions_lookup
  on auth_sessions (session_token)
  where invalidated_at is null;

