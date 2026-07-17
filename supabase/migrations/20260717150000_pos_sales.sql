-- Phase 15 block 2 — POS sales (on-site point of sale).
--
-- A POS sale is a normal paid order (status 'paid') distinguished by
-- payment_method 'cash' or 'terminal', so it flows into sales, settlements,
-- check-in, e-mails and reporting unchanged (all keyed on status='paid'). No
-- GoPay is involved; the platform fee still applies per the organizer's config.
-- Tickets minted at the POS get source='pos'.
--
-- eKasa / fiscal receipts are intentionally NOT handled yet — the sale is only
-- recorded. receipt_number and fiscal_code are nullable placeholders so an eKasa
-- document (receipt number + OKP/QR from FS SR) can be attached later without a
-- schema rebuild.

-- 1. Extend orders.payment_method with the two POS tender types. Discover the
--    existing check by its definition (robust to the auto-generated name), drop
--    and re-add.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'orders'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%payment_method%';
  if c is not null then
    execute format('alter table orders drop constraint %I', c);
  end if;
end $$;

alter table orders add constraint orders_payment_method_check
  check (payment_method in ('gopay', 'manual', 'cash', 'terminal'));

comment on column orders.payment_method is
  'gopay | manual | cash | terminal — how the order was paid. cash/terminal = POS on-site sale.';

-- 2. POS cash bookkeeping + eKasa placeholders (all nullable).
alter table orders
  add column cash_received_cents integer check (cash_received_cents >= 0),
  add column receipt_number       text,
  add column fiscal_code          text;

comment on column orders.cash_received_cents is
  'POS cash sales only: amount tendered by the buyer, in cents. Change = cash_received_cents - total_cents.';
comment on column orders.receipt_number is
  'eKasa fiscal receipt number — added later by the eKasa integration; null until then.';
comment on column orders.fiscal_code is
  'eKasa OKP / verification code (QR) from FS SR — added later; null until then.';

-- 3. Allow tickets minted at the POS to be tagged with source='pos'.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'tickets'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%source%';
  if c is not null then
    execute format('alter table tickets drop constraint %I', c);
  end if;
end $$;

alter table tickets add constraint tickets_source_check
  check (source in ('order', 'guestlist', 'manual', 'pos'));
