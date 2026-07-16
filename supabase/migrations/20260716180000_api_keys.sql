-- Phase 11 block 1 — per-organizer API keys for the public REST API.
-- Only a SHA-256 hash of the key is stored; the plaintext is shown once at
-- creation. A short prefix is kept for display/identification.

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references organizers(id) on delete cascade,
  name text not null default 'API kľúč',
  key_prefix text not null,
  key_hash text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists api_keys_organizer on api_keys (organizer_id);
create unique index if not exists api_keys_hash on api_keys (key_hash);

alter table api_keys enable row level security;
-- No policies: managed by the dashboard (service role) and read by the API auth
-- middleware (service role). Never exposed to anon/authenticated clients.
