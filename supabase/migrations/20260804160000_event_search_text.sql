-- ---------------------------------------------------------------------------
-- Diacritics-insensitive search over the public program
--
-- The /podujatia search box ran `ilike` straight against title and venue_name,
-- so "premiera" found nothing while "premiéra" did — on a Slovak site that is
-- most of the typing. A stored, de-accented, lower-cased copy of the two
-- searchable fields is matched instead; the caller folds the query the same way.
-- ---------------------------------------------------------------------------

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- unaccent() is merely STABLE (it looks up a text-search dictionary), and a
-- generated column demands IMMUTABLE. Pinning the dictionary in the call makes
-- the wrapper deterministic, which is what the immutable label is promising.
create or replace function public.immutable_unaccent(text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, $1)
$$;

comment on function public.immutable_unaccent(text) is
  'IMMUTABLE unaccent wrapper with the dictionary pinned, so it can drive a generated column.';

alter table events
  add column if not exists search_text text
    generated always as (
      lower(
        public.immutable_unaccent(
          coalesce(title, '') || ' ' || coalesce(venue_name, '')
        )
      )
    ) stored;

comment on column events.search_text is
  'Generated: de-accented lower-case "title venue_name", matched by the public search box.';

create index if not exists events_search_text_trgm_idx
  on events using gin (search_text extensions.gin_trgm_ops);
