-- Phase 6 block 1 — refunds.
--
-- Adds the 'partially_refunded' order status and a refunds ledger. A refund row
-- records one GoPay refund request (full order or a single ticket); the order's
-- status is derived from how many of its tickets remain active.

-- Extend the order status enum. Drop the existing status check by discovering
-- its real name (robust to the auto-generated constraint name), then re-add.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'orders'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%';
  if c is not null then
    execute format('alter table orders drop constraint %I', c);
  end if;
end $$;

alter table orders add constraint orders_status_check
  check (status in (
    'pending', 'paid', 'expired', 'cancelled', 'refunded', 'partially_refunded'
  ));

-- Refund ledger.
create table refunds (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders (id) on delete cascade,
  ticket_id        uuid references tickets (id) on delete set null,  -- set for single-ticket (partial) refunds
  amount_cents     integer not null check (amount_cents >= 0),
  gopay_refund_id  text,                          -- gateway reference (null for €0 / non-GoPay refunds)
  status           text not null default 'requested'
                     check (status in ('requested', 'done', 'failed')),
  reason           text,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index refunds_order_id_idx on refunds (order_id);
create index refunds_created_at_idx on refunds (created_at desc);

comment on table refunds is
  'Ledger of refund requests (full order or single ticket). amount_cents in EUR cents; status tracks the gateway result.';

-- Server-only (all reads/writes go through the service role); RLS on, no policies.
alter table refunds enable row level security;
