-- Organizer branding: logo + accent color used on ticket PDFs and (later) the
-- public event page. Logo files live in a public Storage bucket; uploads go
-- through the server (service role), public read for rendering.

alter table organizers
  add column if not exists brand_logo_url text,
  add column if not exists brand_color text;

-- Public bucket for brand assets (logos). Writes are service-role only.
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

-- Public read of branding assets (needed to render logos in PDFs / browser).
drop policy if exists "branding public read" on storage.objects;
create policy "branding public read"
  on storage.objects for select
  using (bucket_id = 'branding');
