-- ---------------------------------------------------------------------------
-- Public read grants for the two new event columns
--
-- 20260730120000_hide_qr_secret_from_public replaced the table-wide SELECT for
-- anon/authenticated with a per-column grant list, so qr_secret could never be
-- read. A column added later is therefore invisible until it is granted by
-- name: without this, every public select that mentions category or search_text
-- fails with "permission denied for table events", and the listing quietly
-- falls back to its pre-category query instead.
--
-- Add new public columns here whenever the events table grows one.
-- ---------------------------------------------------------------------------

grant select (category, search_text) on public.events to anon;
grant select (category, search_text) on public.events to authenticated;
