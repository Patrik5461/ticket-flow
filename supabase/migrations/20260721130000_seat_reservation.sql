-- Phase 21 Block 2 — seat reservation logic (the concurrency-critical part).
--
-- Mirrors the unseated model (reserve_ticket_capacity / release_expired_orders):
-- SECURITY DEFINER, REVOKE public / GRANT service_role. sold_count stays the
-- single reporting counter — a seat HOLD increments it, a RELEASE decrements it,
-- exactly like reserve_ticket_capacity does for unseated types (so sold_count =
-- held + sold for every ticket type, seated or not).

-- ---------------------------------------------------------------------------
-- claim_seats: atomically hold ALL requested seats or NONE.
-- ---------------------------------------------------------------------------
-- The single conditional UPDATE (status = 'available' guard) is the race guard:
-- two buyers racing for the same seat both run the UPDATE, but Postgres row locks
-- serialize them and the second re-checks status against the now-held row, so it
-- doesn't match. If we couldn't grab every requested seat, we undo the ones we
-- did grab (identified by our own order_id) and return false — all-or-nothing.
create or replace function public.claim_seats(
  p_event_id      uuid,
  p_seat_ids      uuid[],
  p_order_id      uuid,
  p_ttl_minutes   integer default 15
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_want    integer;
  v_claimed integer;
begin
  v_want := coalesce(array_length(p_seat_ids, 1), 0);
  if v_want = 0 then
    return false;
  end if;

  update event_seats
     set status     = 'held',
         held_until = now() + make_interval(mins => p_ttl_minutes),
         order_id   = p_order_id,
         updated_at = now()
   where event_id = p_event_id
     and seat_id  = any (p_seat_ids)
     and status   = 'available';
  get diagnostics v_claimed = row_count;

  if v_claimed <> v_want then
    -- Couldn't get them all → release the ones we just grabbed for this order.
    update event_seats
       set status     = 'available',
           held_until = null,
           order_id   = null,
           updated_at = now()
     where event_id = p_event_id
       and order_id = p_order_id
       and status   = 'held';
    return false;
  end if;

  -- Keep sold_count (held + sold) in sync per ticket type.
  update ticket_types tt
     set sold_count = tt.sold_count + agg.n
    from (
      select ticket_type_id, count(*)::integer as n
        from event_seats
       where event_id = p_event_id
         and order_id = p_order_id
         and status   = 'held'
       group by ticket_type_id
    ) agg
   where tt.id = agg.ticket_type_id;

  return true;
end;
$$;

comment on function public.claim_seats(uuid, uuid[], uuid, integer)
  is 'Atomically hold all requested seats for an order or none; true on success.';

-- ---------------------------------------------------------------------------
-- mark_seats_sold: on payment, flip an order's held seats to sold.
-- sold_count is unchanged (already counted at hold time).
-- ---------------------------------------------------------------------------
create or replace function public.mark_seats_sold(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update event_seats
     set status     = 'sold',
         held_until = null,
         updated_at = now()
   where order_id = p_order_id
     and status   = 'held';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.mark_seats_sold(uuid)
  is 'Flip an order''s held seats to sold on payment. Returns count.';

-- ---------------------------------------------------------------------------
-- release_seats_for_order: return an order's seats to available (refund /
-- cancel / manual release) and give back sold_count. Handles held and sold.
-- ---------------------------------------------------------------------------
create or replace function public.release_seats_for_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  -- Give back sold_count for the seats we're about to free.
  update ticket_types tt
     set sold_count = greatest(tt.sold_count - agg.n, 0)
    from (
      select ticket_type_id, count(*)::integer as n
        from event_seats
       where order_id = p_order_id
         and status in ('held', 'sold')
       group by ticket_type_id
    ) agg
   where tt.id = agg.ticket_type_id;

  update event_seats
     set status     = 'available',
         held_until = null,
         order_id   = null,
         updated_at = now()
   where order_id = p_order_id
     and status in ('held', 'sold');
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.release_seats_for_order(uuid)
  is 'Return an order''s seats to available and give back sold_count. Returns count.';

-- ---------------------------------------------------------------------------
-- release_expired_orders: extend the existing cron sweep to also free held
-- seats. Crucially, sold_count for SEATED types is given back via the seat
-- release, so the order_items decrement must skip seated types (else a seated
-- order would double-decrement).
-- ---------------------------------------------------------------------------
create or replace function public.release_expired_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  with locked as (
    select id
      from orders
     where status = 'pending'
       and expires_at is not null
       and expires_at < now()
     for update skip locked
  )
  select array_agg(id) into v_ids from locked;

  if v_ids is null then
    return 0;
  end if;

  -- (1) Seated: give back sold_count for held seats of these orders, then free.
  update ticket_types tt
     set sold_count = greatest(tt.sold_count - agg.n, 0)
    from (
      select ticket_type_id, count(*)::integer as n
        from event_seats
       where order_id = any (v_ids)
         and status = 'held'
       group by ticket_type_id
    ) agg
   where tt.id = agg.ticket_type_id;

  update event_seats
     set status = 'available', held_until = null, order_id = null, updated_at = now()
   where order_id = any (v_ids)
     and status = 'held';

  -- (2) Unseated only: give back capacity via order_items (seated handled above).
  update ticket_types tt
     set sold_count = greatest(tt.sold_count - agg.qty, 0)
    from (
      select oi.ticket_type_id, sum(oi.quantity)::integer as qty
        from order_items oi
        join ticket_types t on t.id = oi.ticket_type_id
       where oi.order_id = any (v_ids)
         and t.seated = false
       group by oi.ticket_type_id
    ) agg
   where tt.id = agg.ticket_type_id;

  update orders
     set status = 'expired'
   where id = any (v_ids);

  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

comment on function public.release_expired_orders()
  is 'Free capacity + held seats from expired pending orders and mark them expired. Returns count.';

-- ---------------------------------------------------------------------------
-- Lock down: service role only (cron runs as owner).
-- ---------------------------------------------------------------------------
revoke execute on function public.claim_seats(uuid, uuid[], uuid, integer) from public;
revoke execute on function public.mark_seats_sold(uuid) from public;
revoke execute on function public.release_seats_for_order(uuid) from public;
grant execute on function public.claim_seats(uuid, uuid[], uuid, integer) to service_role;
grant execute on function public.mark_seats_sold(uuid) to service_role;
grant execute on function public.release_seats_for_order(uuid) to service_role;
