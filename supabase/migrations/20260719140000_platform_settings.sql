-- Phase 18 Block 4 — platform-wide default commission as live data.
--
-- Single source of truth for the default platform fee shown on /cennik AND
-- inherited by every new organizer, so the marketing page and reality can never
-- drift apart. One row (id is a boolean pinned to true). Public read (the
-- pricing page is public); writes only via the platform-admin server function
-- (service role bypasses RLS).

create table if not exists public.platform_settings (
  id boolean primary key default true check (id),
  default_fee_percent numeric(5, 2) not null default 4.0
    check (default_fee_percent >= 0 and default_fee_percent <= 100),
  default_fee_min_cents integer not null default 40
    check (default_fee_min_cents >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.platform_settings (id) values (true) on conflict do nothing;

alter table public.platform_settings enable row level security;

create policy platform_settings_public_read
  on public.platform_settings
  for select
  using (true);

-- New organizers inherit the current platform default. Drop the static column
-- defaults so an insert that omits the fee leaves it NULL, then a BEFORE INSERT
-- trigger fills it from platform_settings. This covers every insert path
-- (onboarding server fn or direct SQL), so a changed default propagates to all
-- new orgs automatically. Explicitly-provided fees are preserved.
alter table public.organizers alter column fee_percent drop default;
alter table public.organizers alter column fee_min_cents drop default;

create or replace function public.organizer_inherit_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.platform_settings%rowtype;
begin
  select * into s from public.platform_settings limit 1;
  if new.fee_percent is null then
    new.fee_percent := coalesce(s.default_fee_percent, 4.0);
  end if;
  if new.fee_min_cents is null then
    new.fee_min_cents := coalesce(s.default_fee_min_cents, 40);
  end if;
  return new;
end;
$$;

create trigger organizer_inherit_fee_trg
  before insert on public.organizers
  for each row execute function public.organizer_inherit_fee();
