-- Phase 8 block 2 — manual orders (on-site / bank transfer sales).
--
-- A manual order is a normal paid order (status 'paid') distinguished by
-- payment_method = 'manual', so it flows into sales and settlements unchanged
-- (which filter on status='paid'). No GoPay is involved; the platform fee still
-- applies per the organizer's config.
alter table orders
  add column payment_method text not null default 'gopay'
    check (payment_method in ('gopay', 'manual'));

comment on column orders.payment_method is
  'gopay | manual — how the order was paid. Manual = organizer-recorded on-site/transfer sale.';
