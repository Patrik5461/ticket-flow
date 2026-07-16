-- Phase 7 block 4 — organizer broadcast to participants ("Napísať účastníkom").
--
-- Each broadcast is a bulk_messages row (the send log); the actual delivery is a
-- 'bulk' email_job per paid buyer, drained by the existing email worker with its
-- retry + throttling. email_jobs.campaign_id links jobs back for delivery counts.

create table bulk_messages (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events (id) on delete cascade,
  subject         text not null,
  body            text not null,
  recipient_count integer not null default 0,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index bulk_messages_event_idx on bulk_messages (event_id, created_at desc);

comment on table bulk_messages is
  'Log of organizer broadcasts to an event''s paid buyers. Delivery is via bulk email_jobs (campaign_id).';

alter table bulk_messages enable row level security; -- server-only, no policies

alter table email_jobs
  add column campaign_id uuid references bulk_messages (id) on delete set null;
create index email_jobs_campaign_idx on email_jobs (campaign_id);
