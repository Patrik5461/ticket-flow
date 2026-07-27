-- Phase (payments) Block 3.
--
-- (A) Distinguish a refunded ticket from an admin-cancelled one at the gate.
--     A refund and a manual admin cancellation both set tickets.status =
--     'cancelled'. refunded_at marks the refund case so the scanner can say
--     "Refundovaná" vs "Zrušená". It is only a MARKER — status stays 'cancelled'
--     so capacity, RLS and every count keep working unchanged.
--
-- (B) Let the GoPay webhook release a declined/cancelled order's capacity
--     immediately (seats included), instead of waiting up to ~15 min for the
--     cron sweep. release_pending_order mirrors release_expired_orders' seated/
--     unseated split for a single order, so a seated order is never
--     double-decremented.

-- (A) refunded marker -------------------------------------------------------

alter table tickets
  add column if not exists refunded_at timestamptz;

comment on column tickets.refunded_at is
  'When this ticket was cancelled BY A REFUND (null for admin cancellations). status stays cancelled; this only lets the scanner show "Refundovaná" vs "Zrušená".';

-- checkin_log gains the 'refunded' scan result. Discover the existing check by
-- its definition (robust to the auto-generated name), drop and re-add.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'checkin_log'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%result%';
  if c is not null then
    execute format('alter table checkin_log drop constraint %I', c);
  end if;
end $$;

alter table checkin_log add constraint checkin_log_result_check
  check (result in (
    'ok', 'already_used', 'invalid', 'cancelled', 'reentry', 'undo', 'refunded'
  ));

comment on constraint checkin_log_result_check on checkin_log is
  'ok=first entry; reentry=allowed subsequent entry; already_used=blocked re-scan; cancelled=admin-cancelled ticket; refunded=refunded ticket; invalid; undo=owner/admin reverted a check-in.';

-- (B) single-order release, seated-safe -------------------------------------

create or replace function public.release_pending_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked uuid;
begin
  -- Only a still-pending order, locked so a concurrent cron sweep can't race.
  select id into v_locked
    from orders
   where id = p_order_id
     and status = 'pending'
   for update skip locked;

  if v_locked is null then
    return false;  -- already paid / cancelled / expired, or held elsewhere
  end if;

  -- (1) Seated: give sold_count back from held seats, then free them.
  update ticket_types tt
     set sold_count = greatest(tt.sold_count - agg.n, 0)
    from (
      select ticket_type_id, count(*)::integer as n
        from event_seats
       where order_id = p_order_id
         and status = 'held'
       group by ticket_type_id
    ) agg
   where tt.id = agg.ticket_type_id;

  update event_seats
     set status = 'available', held_until = null, order_id = null, updated_at = now()
   where order_id = p_order_id
     and status = 'held';

  -- (2) Unseated only: give capacity back via order_items (seated handled above).
  update ticket_types tt
     set sold_count = greatest(tt.sold_count - agg.qty, 0)
    from (
      select oi.ticket_type_id, sum(oi.quantity)::integer as qty
        from order_items oi
        join ticket_types t on t.id = oi.ticket_type_id
       where oi.order_id = p_order_id
         and t.seated = false
       group by oi.ticket_type_id
    ) agg
   where tt.id = agg.ticket_type_id;

  update orders set status = 'cancelled' where id = p_order_id;
  return true;
end;
$$;

comment on function public.release_pending_order(uuid)
  is 'Free a single pending order''s capacity + seats and mark it cancelled (GoPay CANCELED/TIMEOUTED webhook). Seated-safe, mirrors release_expired_orders.';

revoke execute on function public.release_pending_order(uuid) from public;
grant execute on function public.release_pending_order(uuid) to service_role;
