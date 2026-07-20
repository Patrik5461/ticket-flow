-- Phase 23 Block 2 — per-event re-entry toggle.
--
-- When true, scanning an already-used ticket admits it again (result 'reentry',
-- shown green) instead of blocking with 'already_used'. Every entry is written
-- to checkin_log, so the organizer sees how many times each ticket entered. The
-- organizer decides this once per event — a door worker never decides per scan.

alter table events
  add column allow_reentry boolean not null default false;

comment on column events.allow_reentry is
  'When true, an already-used ticket is admitted again on re-scan (logged as reentry) instead of being blocked. Default false.';
