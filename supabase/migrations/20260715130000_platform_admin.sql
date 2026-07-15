-- Phase 5 — platform super-admin: admin identity, organizer lifecycle, audit log.
--
-- Mirrors the app's authorization model: rights are checked in server code (via
-- the service role, which bypasses RLS). The new tables enable RLS with NO
-- permissive policies, so anon/authenticated can neither read nor write them —
-- only server code (service role) touches them.

-- ---------------------------------------------------------------------------
-- Platform administrators (operate the whole platform, across all organizers)
-- ---------------------------------------------------------------------------
create table platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now()
);

comment on table platform_admins
  is 'Users with platform-wide super-admin rights. Checked server-side; existence never revealed to non-admins (routes 404).';

-- ---------------------------------------------------------------------------
-- Organizer lifecycle + moderation context
-- ---------------------------------------------------------------------------
alter table organizers
  add column status text not null default 'active'
    check (status in ('active', 'suspended'));

alter table organizers
  add column admin_notes text;

comment on column organizers.status
  is 'active | suspended. A suspended organizer cannot publish events or sell tickets.';
comment on column organizers.admin_notes
  is 'Free-text platform-admin notes about this organizer (support/moderation).';

-- ---------------------------------------------------------------------------
-- Audit log: append-only trail of platform-admin mutations
-- ---------------------------------------------------------------------------
create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users (id) on delete set null,  -- null if actor later deleted
  action       text not null,          -- e.g. 'organizer.update_fee', 'event.unpublish'
  entity_type  text not null,          -- 'organizer' | 'event' | 'order' | ...
  entity_id    uuid,
  old_value    jsonb,
  new_value    jsonb,
  created_at   timestamptz not null default now()
);

create index audit_log_created_at_idx on audit_log (created_at desc);
create index audit_log_entity_idx on audit_log (entity_type, entity_id);

comment on table audit_log
  is 'Append-only trail of platform-admin actions (who, what, when, old/new). Written server-side (service role).';

-- ---------------------------------------------------------------------------
-- RLS: lock the new tables to server (service role) only, and expose an admin
-- predicate for any future admin-scoped policies.
-- ---------------------------------------------------------------------------
alter table platform_admins enable row level security;
alter table audit_log       enable row level security;

-- True if the current auth user is a platform super-admin. SECURITY DEFINER so
-- it can consult platform_admins without recursing into that table's own RLS.
-- For anon, auth.uid() is null → false.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from platform_admins a where a.user_id = auth.uid()
  );
$$;

comment on function public.is_platform_admin()
  is 'True if the current auth user is a platform super-admin.';
