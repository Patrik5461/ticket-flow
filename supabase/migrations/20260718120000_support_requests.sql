-- Phase 17 block 1 — support requests (e.g. buyer e-mail change) raised by the
-- AI support assistant / anonymous buyer. NOTHING is emailed on creation; the
-- organizer approves, and only then are tickets resent to the new address.

create table if not exists support_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  kind text not null default 'email_change'
    check (kind in ('email_change')),
  requested_email text not null, -- what the requester typed (for matching/audit)
  new_email text,                -- target for email_change
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  note text,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz
);

create index if not exists support_requests_event
  on support_requests (event_id, status, created_at desc);

alter table support_requests enable row level security;
-- No policies: created by public support server fns (service role) and managed by
-- the organizer dashboard (service role, authorized in code).
