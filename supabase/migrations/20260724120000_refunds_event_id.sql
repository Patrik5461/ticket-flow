-- Phase (payments): denormalize event_id onto the refunds ledger.
--
-- The live sales dashboard nets refunds per event every few seconds. Without a
-- direct event_id it would have to filter refunds by the event's order ids
-- (thousands of ids per tick on a busy event). A denormalized, indexed event_id
-- makes that a single indexed lookup. Every refund belongs to exactly one order,
-- which belongs to exactly one event, so the value is immutable once set.

alter table refunds
  add column if not exists event_id uuid references events (id) on delete cascade;

-- Backfill from the owning order.
update refunds r
   set event_id = o.event_id
  from orders o
 where r.order_id = o.id
   and r.event_id is null;

-- Every refund has an order, so the column is now complete and can be required.
alter table refunds
  alter column event_id set not null;

create index if not exists refunds_event_id_idx on refunds (event_id);

comment on column refunds.event_id is
  'Denormalized from orders.event_id (immutable). Lets per-event metrics net refunds with one indexed lookup instead of filtering by order ids.';
