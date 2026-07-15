-- Phase 5 block 3 — plus a fix for the previous migration.
--
-- FIX: 20260715131000 made the public event/ticket-type read policies reference
-- the `organizers` table directly. But organizers has RLS with no anon policy, so
-- the EXISTS subquery returned nothing for the public and hid EVERY published
-- event. We use a SECURITY DEFINER helper (mirrors is_org_member) so the
-- active-organizer check bypasses organizers' own RLS without exposing its rows.

create or replace function public.organizer_is_active(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from organizers o where o.id = p_org and o.status = 'active'
  );
$$;

comment on function public.organizer_is_active(uuid)
  is 'True if the organizer exists and is active. SECURITY DEFINER so RLS policies can check it without exposing organizers to the public.';

drop policy events_public_read on events;
create policy events_public_read on events
  for select using (
    status = 'published' and public.organizer_is_active(organizer_id)
  );

drop policy ticket_types_public_read on ticket_types;
create policy ticket_types_public_read on ticket_types
  for select using (
    not hidden
    and exists (
      select 1 from events e
       where e.id = ticket_types.event_id
         and e.status = 'published'
         and public.organizer_is_active(e.organizer_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Platform support: flexible cross-platform order search.
-- PostgREST cannot ilike a uuid column, so ref/id-prefix search lives in SQL.
-- Matches by buyer email (substring), order id text prefix (full uuid OR the
-- 8-char ref shown in the UI), or exact GoPay payment id. Service-role only;
-- the server fn gates it behind requirePlatformAdmin.
-- ---------------------------------------------------------------------------
create or replace function public.admin_search_orders(p_q text)
returns table (
  id             uuid,
  ref            text,
  buyer_email    text,
  buyer_name     text,
  status         text,
  total_cents    integer,
  created_at     timestamptz,
  paid_at        timestamptz,
  event_id       uuid,
  event_title    text,
  organizer_id   uuid,
  organizer_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         upper(substr(o.id::text, 1, 8))              as ref,
         o.buyer_email,
         o.buyer_name,
         o.status,
         o.total_cents,
         o.created_at,
         o.paid_at,
         e.id                                         as event_id,
         e.title                                      as event_title,
         org.id                                       as organizer_id,
         org.name                                     as organizer_name
    from orders o
    join events e     on e.id = o.event_id
    join organizers org on org.id = e.organizer_id
   where length(btrim(p_q)) > 0
     and (
          o.buyer_email ilike '%' || btrim(p_q) || '%'
       or o.id::text ilike btrim(p_q) || '%'
       or o.gopay_payment_id = btrim(p_q)
     )
   order by o.created_at desc
   limit 50;
$$;

revoke execute on function public.admin_search_orders(text) from public;
grant execute on function public.admin_search_orders(text) to service_role;

comment on function public.admin_search_orders(text)
  is 'Platform-admin order search by email substring, order id/ref prefix, or GoPay payment id. Service-role only.';
