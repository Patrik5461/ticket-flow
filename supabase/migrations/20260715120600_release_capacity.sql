-- Symmetric counterpart to reserve_ticket_capacity: give back capacity for a
-- single ticket type. Used to compensate a half-built order when a later step
-- (payment creation, insert) fails. Floors at zero.

create or replace function public.release_ticket_capacity(
  p_ticket_type_id uuid,
  p_qty            integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_qty is null or p_qty <= 0 then
    return;
  end if;

  update ticket_types
     set sold_count = greatest(sold_count - p_qty, 0)
   where id = p_ticket_type_id;
end;
$$;

comment on function public.release_ticket_capacity(uuid, integer)
  is 'Return p_qty reserved units to a ticket type (compensation path). Floors at 0.';

revoke execute on function public.release_ticket_capacity(uuid, integer) from public;
grant execute on function public.release_ticket_capacity(uuid, integer) to service_role;

-- Atomically bump a coupon's usage counter when an order is fulfilled.
create or replace function public.increment_coupon_use(p_coupon_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update coupons
     set used_count = used_count + 1
   where id = p_coupon_id;
end;
$$;

comment on function public.increment_coupon_use(uuid)
  is 'Increment coupons.used_count by one (called on order fulfilment).';

revoke execute on function public.increment_coupon_use(uuid) from public;
grant execute on function public.increment_coupon_use(uuid) to service_role;
