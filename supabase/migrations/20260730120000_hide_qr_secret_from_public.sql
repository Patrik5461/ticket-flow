-- SECURITY FIX — stop leaking events.qr_secret to the public.
--
-- Problem: RLS filters ROWS, not COLUMNS. The `events_public_read` policy exposes
-- every published event's whole row to the anon role — including `qr_secret`, the
-- HMAC key that signs BOTH ticket QR codes (lib/qr.ts) and order-access tokens
-- (lib/order-token.ts). anon reaches PostgREST directly (the anon key ships in the
-- browser bundle), bypassing the app layer's careful `Omit<EventRow,'qr_secret'>`.
-- Proven: `GET /rest/v1/events?select=id,qr_secret` with only the public anon key
-- returned the secrets of every published event.
--
-- Fix: column-level privileges. `events` relied on Supabase's default table-wide
-- GRANT SELECT to anon/authenticated (no explicit grant exists in earlier
-- migrations). We drop that table-wide grant and re-grant SELECT on an explicit
-- allowlist of every column EXCEPT qr_secret. RLS row-filtering is unchanged.
--
-- service_role is untouched: it BYPASSes RLS and keeps full column access, so all
-- server reads of qr_secret (checkin, order-service, ticket-email, offline-bundle,
-- …) keep working. The two anon-client server routes read only title/venue_name
-- (api.og) and slug (sitemap) — both in the allowlist.
--
-- Fail-closed by design: the allowlist is explicit, so a NEW events column is NOT
-- anon-readable until deliberately added here. If a future public feature needs a
-- new column via the anon client, add it below — and never add qr_secret or any
-- future secret column. Verify with `npm run probe:rls` (scripts/rls-anon-probe.mjs)
-- after every RLS/grant change, per CLAUDE.md.

revoke select on public.events from anon, authenticated;

grant select (
  id,
  organizer_id,
  title,
  slug,
  description,
  venue_name,
  venue_address,
  starts_at,
  ends_at,
  timezone,
  cover_url,
  status,
  created_at,
  ga4_measurement_id,
  meta_pixel_id,
  allow_reentry
) on public.events to anon, authenticated;

-- Belt-and-suspenders: server reads go through service_role; keep it whole.
grant select on public.events to service_role;

-- Assert the fix at apply time: qr_secret must NOT be selectable by anon, and a
-- known-public column (title) must remain selectable. Fails the migration loudly
-- if either invariant is off (e.g. a column was renamed).
do $$
begin
  if has_column_privilege('anon', 'public.events', 'qr_secret', 'SELECT') then
    raise exception 'SECURITY: anon can still SELECT events.qr_secret after migration';
  end if;
  if not has_column_privilege('anon', 'public.events', 'title', 'SELECT') then
    raise exception 'REGRESSION: anon lost SELECT on the public column events.title';
  end if;
end $$;
