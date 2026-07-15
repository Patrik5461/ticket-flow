-- Row Level Security.
--
-- Model:
--   * Organizer staff (rows in organizer_members) may READ their own org's data.
--   * The public (anon + authenticated) may READ published events and their
--     visible ticket types — nothing else.
--   * Orders, tickets, coupons and payment ledger are never exposed to the public;
--     buyers reach their order through signed tokens handled by server routes.
--   * ALL writes go through server functions using the service role, which
--     bypasses RLS. Hence no INSERT/UPDATE/DELETE policies are defined here.

-- Membership check. SECURITY DEFINER so policies can consult organizer_members
-- without recursing into its own RLS. For anon, auth.uid() is null → false.
create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from organizer_members m
     where m.organizer_id = p_org
       and m.user_id = auth.uid()
  );
$$;

comment on function public.is_org_member(uuid)
  is 'True if the current auth user belongs to the given organizer.';

-- Enable RLS everywhere. With RLS on and no permissive policy, a table denies all
-- access to anon/authenticated (the service role always bypasses RLS).
alter table organizers        enable row level security;
alter table organizer_members enable row level security;
alter table events            enable row level security;
alter table ticket_types      enable row level security;
alter table coupons           enable row level security;
alter table orders            enable row level security;
alter table order_items       enable row level security;
alter table tickets           enable row level security;
alter table payment_events    enable row level security;
alter table checkin_log       enable row level security;

-- Organizers: members see their own organizer records.
create policy organizers_member_read on organizers
  for select using (public.is_org_member(id));

-- Membership rows: visible to anyone in the same organizer.
create policy organizer_members_member_read on organizer_members
  for select using (public.is_org_member(organizer_id));

-- Events: members see all their events; the public sees published ones.
create policy events_member_read on events
  for select using (public.is_org_member(organizer_id));

create policy events_public_read on events
  for select using (status = 'published');

-- Ticket types: members see all; the public sees non-hidden types of published events.
create policy ticket_types_member_read on ticket_types
  for select using (
    exists (
      select 1 from events e
       where e.id = ticket_types.event_id
         and public.is_org_member(e.organizer_id)
    )
  );

create policy ticket_types_public_read on ticket_types
  for select using (
    not hidden
    and exists (
      select 1 from events e
       where e.id = ticket_types.event_id
         and e.status = 'published'
    )
  );

-- Coupons: members only. No public policy → validated/applied server-side.
create policy coupons_member_read on coupons
  for select using (
    exists (
      select 1 from events e
       where e.id = coupons.event_id
         and public.is_org_member(e.organizer_id)
    )
  );

-- Orders: members read orders for their events. Buyers use signed tokens (server).
create policy orders_member_read on orders
  for select using (
    exists (
      select 1 from events e
       where e.id = orders.event_id
         and public.is_org_member(e.organizer_id)
    )
  );

-- Order items: members read via the parent order's event.
create policy order_items_member_read on order_items
  for select using (
    exists (
      select 1
        from orders o
        join events e on e.id = o.event_id
       where o.id = order_items.order_id
         and public.is_org_member(e.organizer_id)
    )
  );

-- Tickets: members read tickets for their events.
create policy tickets_member_read on tickets
  for select using (
    exists (
      select 1 from events e
       where e.id = tickets.event_id
         and public.is_org_member(e.organizer_id)
    )
  );

-- Check-in log: members read the audit trail for their events.
create policy checkin_log_member_read on checkin_log
  for select using (
    exists (
      select 1 from events e
       where e.id = checkin_log.event_id
         and public.is_org_member(e.organizer_id)
    )
  );

-- payment_events: no policies. Server (service role) only.
