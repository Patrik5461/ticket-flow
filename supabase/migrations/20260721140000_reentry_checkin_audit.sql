-- Phase 23 Block 1 — re-entry model + check-in audit.
--
-- Extends the check-in log so the full entry/undo history is auditable:
--   * new result types 'reentry' (allowed subsequent entry) and 'undo'
--     (owner/admin reverted a check-in),
--   * performed_by: which staff/admin user performed the scan or undo.
-- (events.allow_reentry lands in Block 2.)

-- 1. Extend checkin_log.result. Discover the existing check by its definition
--    (robust to the auto-generated constraint name), drop and re-add.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'checkin_log'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%result%';
  if c is not null then
    execute format('alter table checkin_log drop constraint %I', c);
  end if;
end $$;

alter table checkin_log add constraint checkin_log_result_check
  check (result in ('ok', 'already_used', 'invalid', 'cancelled', 'reentry', 'undo'));

comment on constraint checkin_log_result_check on checkin_log is
  'ok=first entry; reentry=allowed subsequent entry; already_used=blocked re-scan; cancelled; invalid; undo=owner/admin reverted a check-in.';

-- 2. Audit: who performed this check-in / undo. Nullable + ON DELETE SET NULL so
--    a removed staff account never cascade-deletes the check-in history; legacy
--    rows keep null.
alter table checkin_log
  add column performed_by uuid references auth.users (id) on delete set null;

comment on column checkin_log.performed_by is
  'Staff/admin user who performed this scan or undo (null for pre-Phase-23 rows).';
