-- Domain functions for capacity management.
--
-- These are SECURITY DEFINER so they can be exposed to the server (service role)
-- as RPCs while keeping the underlying tables locked down by RLS. They are NOT
-- granted to anon/authenticated — only the service role (which bypasses RLS) and
-- the cron job invoke them.

-- Atomically reserve `p_qty` units of a ticket type. Returns true if the
-- reservation fit within capacity, false otherwise. The single conditional
-- UPDATE is the concurrency guard: two racing buyers cannot oversell because the
-- WHERE clause re-checks capacity against the freshly locked row.
create or replace function public.reserve_ticket_capacity(
  p_ticket_type_id uuid,
  p_qty            integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_qty is null or p_qty <= 0 then
    return false;
  end if;

  update ticket_types
     set sold_count = sold_count + p_qty
   where id = p_ticket_type_id
     and sold_count + p_qty <= capacity;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

comment on function public.reserve_ticket_capacity(uuid, integer)
  is 'Atomically reserve capacity for a ticket type; true if it fit, false if it would oversell.';

-- Release reservations held by expired pending orders and mark them expired.
-- Returns the number of orders released. Called every minute by pg_cron.
create or replace function public.release_expired_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  -- Lock the expired pending orders (skip rows a concurrent run already holds).
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

  -- Give the reserved capacity back to each affected ticket type.
  update ticket_types tt
     set sold_count = greatest(tt.sold_count - agg.qty, 0)
    from (
      select oi.ticket_type_id, sum(oi.quantity)::integer as qty
        from order_items oi
       where oi.order_id = any (v_ids)
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
  is 'Free capacity from expired pending orders and mark them expired. Returns count released.';

-- Lock these down: drop the default PUBLIC execute grant (which would let anon /
-- authenticated call them), then grant execute only to the service role. The cron
-- job runs as the function owner and can execute regardless.
revoke execute on function public.reserve_ticket_capacity(uuid, integer) from public;
revoke execute on function public.release_expired_orders() from public;
grant execute on function public.reserve_ticket_capacity(uuid, integer) to service_role;
grant execute on function public.release_expired_orders() to service_role;
