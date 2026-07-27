-- Phase (payments) Block 2 — surface the platform fee kept on refunded orders.
--
-- The platform keeps its fee even when an order is refunded (no proportional
-- return). Net already reflects that (net = gross − fee − refunded), but the
-- organizer could not see WHY net dipped — the kept fee on refunded orders was
-- buried inside the total fee. This adds it as its own stored line so the
-- settlement document explains itself and net is never a mystery.
--
-- Definition: sum of fee_cents over orders in the settlement that have at least
-- one non-failed refund (fully or partially refunded). The whole order's fee is
-- counted — the fee is kept in full even on a partial refund.

alter table settlements
  add column if not exists fee_on_refunded_cents integer not null default 0;

comment on column settlements.fee_on_refunded_cents is
  'Platform fee kept on orders that were (fully or partially) refunded. A subset of fee_cents, shown as its own line so net (= gross − fee − refunded) is never an unexplained dip.';

-- Recompute now also fills the new line.
create or replace function public.recompute_settlement(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gross            integer;
  v_fee              integer;
  v_refunded         integer;
  v_fee_on_refunded  integer;
  v_count            integer;
begin
  select coalesce(sum(o.total_cents), 0),
         coalesce(sum(o.fee_cents), 0),
         count(*)
    into v_gross, v_fee, v_count
    from orders o
   where o.settlement_id = p_id;

  select coalesce(sum(rf.amount_cents), 0)
    into v_refunded
    from refunds rf
    join orders o on o.id = rf.order_id
   where o.settlement_id = p_id
     and rf.status <> 'failed';

  -- Fee on orders touched by a (non-failed) refund. Distinct order → its full
  -- fee, counted once even if the order had several refund rows.
  select coalesce(sum(o.fee_cents), 0)
    into v_fee_on_refunded
    from orders o
   where o.settlement_id = p_id
     and exists (
       select 1 from refunds rf
        where rf.order_id = o.id
          and rf.status <> 'failed'
     );

  update settlements
     set gross_cents           = v_gross,
         fee_cents             = v_fee,
         refunded_cents        = v_refunded,
         fee_on_refunded_cents = v_fee_on_refunded,
         net_cents             = v_gross - v_fee - v_refunded,
         order_count           = v_count,
         generated_at          = now()
   where id = p_id;

  return v_count;
end;
$$;

-- Backfill every existing settlement's new line.
select public.recompute_settlement(id) from settlements;
