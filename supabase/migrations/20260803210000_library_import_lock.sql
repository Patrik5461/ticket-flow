-- Protect a hand-corrected library hall from the next import.
--
-- The shared library is filled by scripts/import-halls.ts, which is idempotent
-- BY DESIGN: it matches on external_ref and rewrites the venue and its maps in
-- place, so a re-run picks up a corrected export. That is right for the common
-- case and wrong for the one that matters here — a hall an admin repaired by
-- hand in /admin/haly would be silently reverted on the next run, and nobody
-- would know until an organizer sold seats off a broken map again.
--
-- import_locked_at is that hall's answer: set by the admin editor on every
-- save, checked by the importer, cleared from the admin UI when the hall should
-- track the export again. A timestamp rather than a boolean because "since
-- when" is the question asked when a re-import comes out short.
--
-- WHO locked it is deliberately NOT stored here. Both tables are readable by
-- any authenticated organizer for public halls (20260803120004), and an admin's
-- user id has no business in that set. The trail lives in audit_log, which has
-- RLS on and no policies at all — service role only.
--
-- Additive and nullable, so an existing row means "not locked" and the running
-- app (which selects explicit column lists) is unaffected either way.

alter table venues    add column if not exists import_locked_at timestamptz;
alter table seat_maps add column if not exists import_locked_at timestamptz;

comment on column venues.import_locked_at is
  'Set when a platform admin edits this library hall by hand; scripts/import-halls.ts then leaves its name and address alone. Null = tracks the export.';
comment on column seat_maps.import_locked_at is
  'Set when a platform admin edits this map by hand; scripts/import-halls.ts then leaves its layout and seats alone. Null = tracks the export.';

-- The importer asks "is this locked?" once per hall it is about to write, and
-- the admin list asks for the locked ones. Partial: locked rows are the rare
-- case, so the index stays tiny.
create index if not exists venues_import_locked
  on venues (id) where import_locked_at is not null;
create index if not exists seat_maps_import_locked
  on seat_maps (venue_id) where import_locked_at is not null;
