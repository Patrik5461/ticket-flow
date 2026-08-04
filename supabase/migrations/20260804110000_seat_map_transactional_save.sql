-- Saving a seat map used to be "delete every seat, then insert the new ones in
-- chunks of 1000" from the app: several separate statements, no transaction. A
-- network blip, a statement timeout or a closed tab between them left the map
-- empty or half written, and there was no way back — the biggest hall in the
-- library is 11 604 seats, i.e. 12 sequential round trips after the delete.
--
-- Two editors on the same map had the same problem from the other side: nothing
-- serialized them, so one save's delete could land in the middle of the other's
-- inserts and the result was a mix of both maps.
--
-- save_seat_map() does the whole rewrite in ONE transaction, takes a row lock on
-- the map so concurrent saves queue instead of interleaving, and refuses a save
-- whose expected updated_at no longer matches (optimistic lock: "somebody else
-- saved while you were editing"). The in-use check moved in here too — outside
-- the lock it was a TOCTOU: an event could be bound to the map between the check
-- and the delete, and the delete would cascade its event_seats away.
--
-- Errors are raised with a stable code as the message; src/server/venues.ts maps
-- them to Slovak text.

create or replace function public.save_seat_map(
  p_seat_map_id uuid,
  p_venue_id uuid,
  p_name text,
  p_layout jsonb,
  p_seats jsonb,
  p_external_ref text default null,
  p_expected_updated_at timestamptz default null
)
returns table (out_id uuid, out_updated_at timestamptz, out_seat_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := p_seat_map_id;
  v_venue_id uuid;
  v_updated_at timestamptz;
begin
  if v_id is null then
    insert into public.seat_maps (venue_id, name, layout, external_ref)
    values (p_venue_id, p_name, coalesce(p_layout, '{}'::jsonb), p_external_ref)
    returning seat_maps.id into v_id;
  else
    -- FOR UPDATE is what makes two concurrent saves take turns; everything
    -- below runs while this row is held.
    select seat_maps.venue_id, seat_maps.updated_at
      into v_venue_id, v_updated_at
      from public.seat_maps
     where seat_maps.id = v_id
       for update;

    if not found then
      raise exception 'MAP_NOT_FOUND';
    end if;

    -- venueId and seatMapId arrive from the client separately; pinning them
    -- together here means a map can never be written through another hall's id,
    -- whichever entry point called us.
    if v_venue_id is distinct from p_venue_id then
      raise exception 'MAP_VENUE_MISMATCH';
    end if;

    if p_expected_updated_at is not null
       and v_updated_at is distinct from p_expected_updated_at then
      raise exception 'MAP_STALE';
    end if;

    if exists (
      select 1 from public.event_seat_maps where event_seat_maps.seat_map_id = v_id
    ) then
      raise exception 'MAP_IN_USE';
    end if;

    update public.seat_maps
       set name = p_name,
           layout = coalesce(p_layout, '{}'::jsonb),
           updated_at = now()
     where seat_maps.id = v_id;

    delete from public.seats where seats.seat_map_id = v_id;
  end if;

  if p_seats is not null and jsonb_typeof(p_seats) = 'array' then
    insert into public.seats (
      seat_map_id, level, level_order, sector, row_label, seat_number,
      x, y, seat_type, external_ref
    )
    select
      v_id,
      coalesce(s.level, 'main'),
      coalesce(s.level_order, 0),
      s.sector,
      s.row_label,
      s.seat_number,
      coalesce(s.x, 0),
      coalesce(s.y, 0),
      coalesce(nullif(s.seat_type, ''), 'standard'),
      s.external_ref
    from jsonb_to_recordset(p_seats) as s(
      level text,
      level_order integer,
      sector text,
      row_label text,
      seat_number text,
      x double precision,
      y double precision,
      seat_type text,
      external_ref text
    );
  end if;

  return query
    select v_id,
           (select seat_maps.updated_at from public.seat_maps where seat_maps.id = v_id),
           (select count(*)::integer from public.seats where seats.seat_map_id = v_id);
end;
$$;

-- The app calls this with the service role only. Authorization (which organizer
-- owns the venue, whether the caller is a platform admin) lives in the server
-- functions; this one would happily rewrite any map it is given, so nobody else
-- gets to call it.
revoke all on function public.save_seat_map(
  uuid, uuid, text, jsonb, jsonb, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.save_seat_map(
  uuid, uuid, text, jsonb, jsonb, text, timestamptz
) to service_role;
