-- ---------------------------------------------------------------------------
-- City on an event, and the city list the public filter is built from
--
-- Events carried only `venue_name` / `venue_address` as free text, so "what is
-- on in Košice" was unanswerable. City becomes its own field, filled in by the
-- organiser, with a de-accented lower-case key beside it: organisers type
-- "Kosice", "košice" and "Košice" and all three have to be one filter chip.
--
-- `search_text` is rebuilt to include the city, so the search box finds an
-- event by its city too. A generated column's expression cannot be altered in
-- place — it is dropped and re-added.
-- ---------------------------------------------------------------------------

alter table events
  add column if not exists city text;

comment on column events.city is
  'City the event takes place in, as the organiser typed it. Displayed as-is; matched through city_key.';

alter table events
  add column if not exists city_key text
    generated always as (
      lower(public.immutable_unaccent(coalesce(city, '')))
    ) stored;

comment on column events.city_key is
  'Generated: de-accented lower-case city, so "Kosice" and "Košice" are one filter value.';

drop index if exists events_search_text_trgm_idx;

alter table events
  drop column if exists search_text;

alter table events
  add column search_text text
    generated always as (
      lower(
        public.immutable_unaccent(
          coalesce(title, '') || ' ' ||
          coalesce(venue_name, '') || ' ' ||
          coalesce(city, '')
        )
      )
    ) stored;

comment on column events.search_text is
  'Generated: de-accented lower-case "title venue_name city", matched by the public search box.';

create index if not exists events_search_text_trgm_idx
  on events using gin (search_text extensions.gin_trgm_ops);

-- The public program filters on status + city and orders by start.
create index if not exists events_status_city_starts_idx
  on events (status, city_key, starts_at);

-- Column-level grants, same reason as 20260804161000: anon holds a named list.
grant select (city, city_key, search_text) on public.events to anon;
grant select (city, city_key, search_text) on public.events to authenticated;

-- ---------------------------------------------------------------------------
-- Cities to offer as filter chips
--
-- DISTINCT is not something PostgREST can express, and paging the whole table
-- client-side to collect cities would hit the 1000-row cap. Invoker rights on
-- purpose: RLS then shows the caller exactly the events it may see anyway.
-- ---------------------------------------------------------------------------
create or replace function public.public_event_cities()
returns table (city text, city_key text, event_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select e.city, e.city_key, count(*)::bigint as event_count
  from events e
  where e.status = 'published'
    and e.city is not null
    and e.city <> ''
    and coalesce(e.ends_at, e.starts_at) >= now()
  group by e.city, e.city_key
  order by count(*) desc, e.city asc
$$;

comment on function public.public_event_cities() is
  'Cities with at least one upcoming published event, most events first — the filter chips on /podujatia.';

grant execute on function public.public_event_cities() to anon;
grant execute on function public.public_event_cities() to authenticated;
