-- ---------------------------------------------------------------------------
-- Event category (genre)
--
-- The public program had nothing to filter by: every event was just a card in
-- one flat list. A category is picked by the organiser when the event is
-- created and drives the filter chips on /podujatia.
--
-- The allowed values are duplicated in src/lib/event-categories.ts — that file
-- is the one humans edit; keep this check in sync when a category is added.
-- ---------------------------------------------------------------------------

alter table events
  add column if not exists category text;

alter table events
  drop constraint if exists events_category_check;

alter table events
  add constraint events_category_check
    check (
      category is null
      or category in (
        'koncert',
        'festival',
        'divadlo',
        'sport',
        'konferencia',
        'party',
        'film',
        'vystava',
        'pre-deti',
        'workshop',
        'ine'
      )
    );

comment on column events.category is
  'Public genre/type, used for the filter on /podujatia. Null = unclassified (every event created before this migration).';

-- The public listing always filters on status and often on category too.
create index if not exists events_status_category_idx
  on events (status, category);
