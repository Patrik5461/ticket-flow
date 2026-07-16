-- Phase 13 block 1 — event cover images. Public Storage bucket; uploads go
-- through the dashboard (service role), public read for rendering on the landing
-- card, event hero, OG image, and embed. events.cover_url already exists.

insert into storage.buckets (id, name, public)
values ('event-covers', 'event-covers', true)
on conflict (id) do nothing;

drop policy if exists "event-covers public read" on storage.objects;
create policy "event-covers public read"
  on storage.objects for select
  using (bucket_id = 'event-covers');
