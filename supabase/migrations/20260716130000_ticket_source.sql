-- Phase 8 block 1 — guestlist / comp tickets (tickets without an order).
--
-- Guestlist tickets have no order, so order_id becomes nullable and a `source`
-- distinguishes them. holder_email carries the recipient for orderless tickets
-- (order tickets still take the address from their order). email_jobs gains a
-- ticket_id so a single-ticket delivery job can render + send it.

alter table tickets alter column order_id drop not null;

alter table tickets
  add column source text not null default 'order'
    check (source in ('order', 'guestlist', 'manual')),
  add column holder_email text;

comment on column tickets.source is
  'order | guestlist | manual — how the ticket was created.';
comment on column tickets.holder_email is
  'Recipient for orderless tickets (guestlist/manual); order tickets use the order email.';

alter table email_jobs
  add column ticket_id uuid references tickets (id) on delete cascade;
create index email_jobs_ticket_idx on email_jobs (ticket_id);
