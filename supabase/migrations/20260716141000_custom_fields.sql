-- Phase 9 block 4 — custom form fields per ticket type + attendee answers.
--
-- A ticket type carries a small field schema (custom_fields). Answers are captured
-- at checkout (staged on orders.custom_answers, keyed by ticket_type_id), then
-- copied to ticket_answers per ticket when tickets are issued.

alter table ticket_types
  add column custom_fields jsonb not null default '[]'::jsonb;

comment on column ticket_types.custom_fields is
  'Array of {key,label,type(text|select|checkbox),required,options?} — extra checkout fields per attendee.';

alter table orders
  add column custom_answers jsonb;

comment on column orders.custom_answers is
  'Staging for attendee answers at checkout: { [ticket_type_id]: [ {fieldKey: value}, ... ] } aligned with quantities.';

create table ticket_answers (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references tickets (id) on delete cascade,
  order_id     uuid references orders (id) on delete cascade,
  event_id     uuid references events (id) on delete cascade,
  field_key    text not null,
  field_label  text not null,
  value        text,
  created_at   timestamptz not null default now()
);

create index ticket_answers_ticket_idx on ticket_answers (ticket_id);
create index ticket_answers_event_idx on ticket_answers (event_id);

comment on table ticket_answers is
  'Answers to a ticket type''s custom fields, one row per (ticket, field).';

alter table ticket_answers enable row level security; -- server-only, no policies
