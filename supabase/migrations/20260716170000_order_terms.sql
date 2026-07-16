-- Phase 10 block 3 — record the buyer's terms consent time on the order.
-- Written best-effort by the order flow; nullable so historical orders and any
-- pre-migration window are fine.

alter table orders
  add column if not exists terms_accepted_at timestamptz;
