-- Phase 9 block 6 — waitlist. Buyers can "watch availability" on a sold-out
-- ticket type; when capacity frees (reservation expiry / refund) a pg_cron tick
-- pings the app worker, which notifies the first N waiting people with a
-- time-limited checkout link.

create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  ticket_type_id uuid not null references ticket_types(id) on delete cascade,
  email text not null,
  -- waiting → notified → (requeued to waiting on expiry) ; cancelled unused
  status text not null default 'waiting',
  notified_at timestamptz,
  notify_expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- One active signup per (type, email); lets a repeat signup be a no-op.
create unique index if not exists waitlist_unique_waiting
  on waitlist_entries (ticket_type_id, lower(email))
  where status = 'waiting';

-- FIFO scan per type.
create index if not exists waitlist_scan
  on waitlist_entries (ticket_type_id, status, created_at);

alter table waitlist_entries enable row level security;
-- No policies: server-only via service role (public signup goes through a
-- server function, notifications through the cron worker).

-- pg_cron → pg_net bridge. Pings the worker only when some waiting entry's type
-- has free capacity. No-op until app_settings.waitlist_cron_endpoint is set.
create extension if not exists pg_net;

create or replace function public.trigger_waitlist_processing()
returns void
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_url     text;
  v_secret  text;
  v_pending integer;
begin
  select count(*) into v_pending
    from waitlist_entries w
    join ticket_types tt on tt.id = w.ticket_type_id
   where w.status = 'waiting'
     and tt.sold_count < tt.capacity;
  if v_pending = 0 then
    return;
  end if;

  select value into v_url from app_settings where key = 'waitlist_cron_endpoint';
  select value into v_secret from app_settings where key = 'cron_secret';
  if v_url is null then
    return; -- not configured yet (e.g. local dev)
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(v_secret, '')
    ),
    body := '{}'::jsonb
  );
end;
$$;

comment on function public.trigger_waitlist_processing() is
  'Every-minute pg_cron tick: pings the app waitlist worker via pg_net when a waiting entry''s ticket type has free capacity. No-op until app_settings.waitlist_cron_endpoint is set.';

do $$
begin
  perform cron.unschedule('process-waitlist');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'process-waitlist',
  '* * * * *',
  $$select public.trigger_waitlist_processing();$$
);
