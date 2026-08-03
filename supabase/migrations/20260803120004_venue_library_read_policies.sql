-- Read policies for the shared venue library.
--
-- ALREADY APPLIED ON PRODUCTION out of band; this file exists so the repo
-- matches the live schema. Every statement is idempotent (drop … if exists
-- before create), so a replay against production is a no-op.
--
-- venues / seat_maps / seats were created by 20260721120000_seating_model.sql
-- with RLS on and NO policies at all — server-only through the service role.
-- The library adds SELECT policies (own rows + public library rows) so the
-- tables can also be read directly by an authenticated organizer.
--
-- Deliberately NO insert/update/delete policies: every write still goes through
-- a server function on the service role, which bypasses RLS. That is also what
-- keeps library halls read-only at the database level — there is no write path
-- for authenticated at all, so a public hall cannot be edited by anyone but us.
--
-- The seat_maps / seats policies consult venues through is_org_member() rather
-- than a plain subquery on venues, so they do not depend on the reader also
-- passing the venues policy (the cross-table RLS pitfall documented in
-- CLAUDE.md).

alter table venues    enable row level security;
alter table seat_maps enable row level security;
alter table seats     enable row level security;

-- ---------------------------------------------------------------------------
-- venues — own rows, plus every public library hall
-- ---------------------------------------------------------------------------
drop policy if exists venues_read_own_or_public on venues;
create policy venues_read_own_or_public on venues
  for select
  to authenticated
  using (
    public.is_org_member(organizer_id)
    or (is_public and organizer_id is null)
  );

-- ---------------------------------------------------------------------------
-- seat_maps — maps of a venue the reader may see
-- ---------------------------------------------------------------------------
drop policy if exists seat_maps_read_own_or_public on seat_maps;
create policy seat_maps_read_own_or_public on seat_maps
  for select
  to authenticated
  using (
    exists (
      select 1
        from venues v
       where v.id = seat_maps.venue_id
         and (
           public.is_org_member(v.organizer_id)
           or (v.is_public and v.organizer_id is null)
         )
    )
  );

-- ---------------------------------------------------------------------------
-- seats — seats of a map the reader may see
-- ---------------------------------------------------------------------------
drop policy if exists seats_read_own_or_public on seats;
create policy seats_read_own_or_public on seats
  for select
  to authenticated
  using (
    exists (
      select 1
        from seat_maps m
        join venues v on v.id = m.venue_id
       where m.id = seats.seat_map_id
         and (
           public.is_org_member(v.organizer_id)
           or (v.is_public and v.organizer_id is null)
         )
    )
  );
