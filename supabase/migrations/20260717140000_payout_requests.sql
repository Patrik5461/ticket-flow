-- Phase 13 block 4 — payout (advance) requests. The organizer requests a payout
-- of their available net balance; a platform admin approves / rejects / marks it
-- paid. The actual bank transfer is manual — this table only tracks state.

create table if not exists payout_requests (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references organizers(id) on delete cascade,
  amount_cents integer not null,
  -- requested → approved → paid ; requested/approved → rejected
  status text not null default 'requested',
  note text,
  created_by uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payout_requests_organizer
  on payout_requests (organizer_id, created_at desc);
create index if not exists payout_requests_status on payout_requests (status);

alter table payout_requests enable row level security;
-- No policies: managed by the dashboard (organizer request) + admin panel via
-- service role. Authorization is enforced in code.
