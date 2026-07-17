-- Phase 15 block 3 — POS seller attribution.
--
-- Records which staff user rang up a sale, so the POS overview can show who sold
-- what (and reconcile the cash drawer per seller at the end of the day). Nullable
-- and ON DELETE SET NULL: only POS/manual sales set it, and a deleted staff user
-- must not cascade-delete the order history.

alter table orders
  add column sold_by uuid references auth.users (id) on delete set null;

comment on column orders.sold_by is
  'Staff user who rang up a POS/manual sale (null for online GoPay orders).';

create index orders_sold_by_idx on orders (sold_by) where sold_by is not null;
