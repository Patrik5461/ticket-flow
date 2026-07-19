-- Phase 18 Block 1 — CMS foundation.
--
-- Editable content for public static pages (VOP, GDPR, cookies, "ako to
-- funguje", kontakt, …). One row per page, addressed by a stable slug `key`.
-- Body is Markdown, rendered safely (no raw HTML) on the frontend.
--
-- RLS: public read (these are public pages, so even anon/REST may read); no
-- write policies — all writes go through the platform-admin server function
-- using the service role (which bypasses RLS). The public-read policy reads no
-- other table, so no SECURITY DEFINER helper is needed here.

create table if not exists public.content_blocks (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  body text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.content_blocks enable row level security;

create policy content_blocks_public_read
  on public.content_blocks
  for select
  using (true);
