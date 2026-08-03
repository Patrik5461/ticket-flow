-- Shared venue library — public halls that belong to no organizer.
--
-- ALREADY APPLIED ON PRODUCTION out of band; this file exists so the repo
-- matches the live schema. Every statement is idempotent, so a replay against
-- production is a no-op.
--
-- Model: a library hall has organizer_id = null and is_public = true. Every
-- organizer may READ it and assign its seat map to an event, but nobody may
-- edit it — an organizer who needs a variant duplicates it into their own
-- venues (duplicateVenueFn in src/server/venues.ts), which writes a fresh copy
-- with their organizer_id and external_ref = null.
--
-- Organizer-owned venues keep organizer_id not null in practice; the column is
-- nullable only so library rows can exist without an owner.

-- ---------------------------------------------------------------------------
-- venues.organizer_id — nullable, so a hall can be owned by nobody
-- ---------------------------------------------------------------------------
alter table venues alter column organizer_id drop not null;

-- ---------------------------------------------------------------------------
-- venues.is_public — the library flag
-- ---------------------------------------------------------------------------
alter table venues add column if not exists is_public boolean not null default false;

comment on column venues.is_public
  is 'True for shared library halls (organizer_id is null): readable by every organizer, editable by none.';
