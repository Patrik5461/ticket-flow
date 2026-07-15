-- Phase 5 — a suspended organizer must disappear from the public entirely.
--
-- Selling and publishing are already blocked in server code, but the public event
-- reads use the anon client (RLS-governed), so we also tighten the public read
-- policies to require the owning organizer to be active. Member (organizer staff)
-- policies are unchanged: a suspended organizer's own team still sees its events
-- in the dashboard.

-- Published events are public only while their organizer is active.
drop policy events_public_read on events;
create policy events_public_read on events
  for select using (
    status = 'published'
    and exists (
      select 1 from organizers o
       where o.id = events.organizer_id
         and o.status = 'active'
    )
  );

-- Ticket types are public only for a published event of an active organizer.
drop policy ticket_types_public_read on ticket_types;
create policy ticket_types_public_read on ticket_types
  for select using (
    not hidden
    and exists (
      select 1
        from events e
        join organizers o on o.id = e.organizer_id
       where e.id = ticket_types.event_id
         and e.status = 'published'
         and o.status = 'active'
    )
  );
