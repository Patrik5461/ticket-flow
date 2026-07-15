-- Phase 6 block 2 — event cancellation: bulk-refund queue.
--
-- Cancelling an event enqueues one refund_job per paid order. A worker (the
-- /api/cron/process-refunds endpoint, pinged by pg_cron — see the next migration)
-- drains the queue idempotently, retrying failures up to max_attempts. One job
-- per order (unique) makes re-enqueue a no-op.

create table refund_jobs (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references events (id) on delete cascade,
  order_id     uuid not null references orders (id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending', 'processing', 'done', 'failed')),
  attempts     integer not null default 0,
  max_attempts integer not null default 5,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (order_id)
);

create index refund_jobs_status_idx on refund_jobs (status);

comment on table refund_jobs is
  'Queue of per-order refunds created when an event is cancelled. Drained idempotently by the app worker with bounded retries.';

alter table refund_jobs enable row level security; -- server-only, no policies

-- Small server-only key/value config (e.g. the cron endpoint URL + shared secret
-- read by the pg_cron trigger). Seeded outside migrations so the secret never
-- lives in the repo.
create table app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

comment on table app_settings is
  'Server-only key/value settings (cron_endpoint, cron_secret, …). No RLS policies; service role only.';

alter table app_settings enable row level security; -- server-only, no policies
