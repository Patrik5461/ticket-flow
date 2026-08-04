-- Putting a hall on sale had the same shape of problem the seat-map save just
-- lost (20260804110000): assignSeatMapToEventFn deleted the event's seats, its
-- pricing and its map binding, then re-inserted all of it in a dozen separate
-- statements. Nothing tied those together, so an interrupted request could
-- leave an event with a map and no seats, or seats priced by a mapping that had
-- already been deleted. On an 11 604-seat arena that is twelve round trips of
-- seat rows travelling from the app to the database and back for no reason —
-- the seats are already in the database.
--
-- assign_seat_map() does it in one transaction, and builds event_seats from
-- `seats` in SQL instead of shipping them. The "nothing held or sold" check
-- moved inside the lock as well: outside it, a seat could be bought between the
-- check and the delete, and the delete would take the sold seat with it.
--
-- Errors are raised with a stable code (SECTOR_UNPRICED carries the sector
-- name after a colon); src/server/event-seating.ts maps them to Slovak.

create or replace function public.assign_seat_map(
  p_event_id uuid,
  p_seat_map_id uuid,
  -- [{sector, ticket_type_id}], standing areas included as '#<objectId>'
  p_pricing jsonb,
  -- [{ticket_type_id, capacity}] per standing area
  p_areas jsonb default '[]'::jsonb
)
returns table (out_seat_count integer, out_standing_capacity integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unpriced text;
  v_foreign uuid;
  v_seats integer;
  v_standing integer;
begin
  perform 1 from public.events where events.id = p_event_id for update;
  if not found then
    raise exception 'EVENT_NOT_FOUND';
  end if;

  -- Inside the lock: between the app's check and this delete, a buyer could
  -- have taken a seat, and event_seats is where a held/sold seat lives.
  if exists (
    select 1 from public.event_seats
     where event_seats.event_id = p_event_id
       and event_seats.status in ('held', 'sold')
  ) then
    raise exception 'EVENT_HAS_LIVE_SEATS';
  end if;

  -- A sector with no price would simply not join below and its seats would go
  -- missing from the sale without a word.
  select s.sector into v_unpriced
    from public.seats s
   where s.seat_map_id = p_seat_map_id
     and not exists (
       select 1 from jsonb_to_recordset(p_pricing) as p(sector text, ticket_type_id uuid)
        where p.sector = s.sector
     )
   limit 1;
  if v_unpriced is not null then
    raise exception 'SECTOR_UNPRICED:%', v_unpriced;
  end if;

  -- Every referenced category has to belong to this event; a foreign one would
  -- price this event's seats from somebody else's catalogue.
  select p.ticket_type_id into v_foreign
    from jsonb_to_recordset(p_pricing) as p(sector text, ticket_type_id uuid)
   where not exists (
     select 1 from public.ticket_types tt
      where tt.id = p.ticket_type_id and tt.event_id = p_event_id
   )
   limit 1;
  if v_foreign is not null then
    raise exception 'TICKET_TYPE_FOREIGN';
  end if;

  delete from public.event_seats where event_seats.event_id = p_event_id;
  delete from public.event_sector_pricing
   where event_sector_pricing.event_id = p_event_id;
  delete from public.event_seat_maps
   where event_seat_maps.event_id = p_event_id;

  insert into public.event_seat_maps (event_id, seat_map_id)
  values (p_event_id, p_seat_map_id);

  insert into public.event_sector_pricing (event_id, sector, ticket_type_id)
  select p_event_id, p.sector, p.ticket_type_id
    from jsonb_to_recordset(p_pricing) as p(sector text, ticket_type_id uuid);

  -- The seats never leave the database: this is the whole "generate the event's
  -- seats" step that used to be a dozen chunked inserts from the app.
  insert into public.event_seats (event_id, seat_id, ticket_type_id, status)
  select p_event_id,
         s.id,
         pr.ticket_type_id,
         case when s.seat_type = 'blocked' then 'blocked' else 'available' end
    from public.seats s
    join public.event_sector_pricing pr
      on pr.event_id = p_event_id and pr.sector = s.sector
   where s.seat_map_id = p_seat_map_id;
  get diagnostics v_seats = row_count;

  -- A seated category's capacity IS its seat count.
  update public.ticket_types tt
     set seated = true, capacity = c.n
    from (
      select pr.ticket_type_id, count(*)::integer as n
        from public.seats s
        join public.event_sector_pricing pr
          on pr.event_id = p_event_id and pr.sector = s.sector
       where s.seat_map_id = p_seat_map_id
       group by pr.ticket_type_id
    ) c
   where tt.id = c.ticket_type_id;

  -- Standing areas stay unseated: a quantity capped at the area's capacity,
  -- summed when several areas share one category.
  update public.ticket_types tt
     set seated = false, capacity = c.cap
    from (
      select a.ticket_type_id, sum(a.capacity)::integer as cap
        from jsonb_to_recordset(p_areas) as a(ticket_type_id uuid, capacity integer)
       group by a.ticket_type_id
    ) c
   where tt.id = c.ticket_type_id;

  select coalesce(sum(a.capacity), 0)::integer into v_standing
    from jsonb_to_recordset(p_areas) as a(ticket_type_id uuid, capacity integer);

  return query select v_seats, v_standing;
end;
$$;

revoke all on function public.assign_seat_map(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.assign_seat_map(uuid, uuid, jsonb, jsonb)
  to service_role;
