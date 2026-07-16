-- Phase 11 block 3 — outgoing webhooks. Organizers register endpoints and
-- subscribe to event types (order.paid, ticket.checked_in). Deliveries are
-- queued and drained by a cron worker with HMAC-signed, retried POSTs.

create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references organizers(id) on delete cascade,
  url text not null,
  secret text not null,
  events text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists webhook_endpoints_organizer
  on webhook_endpoints (organizer_id);

create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 6,
  response_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index if not exists webhook_deliveries_claim
  on webhook_deliveries (status, created_at);

alter table webhook_endpoints enable row level security;
alter table webhook_deliveries enable row level security;
-- No policies: managed by the dashboard + worker via service role.

-- pg_cron → pg_net bridge. Pings the worker when deliveries are claimable.
-- No-op until app_settings.webhook_cron_endpoint is set.
create extension if not exists pg_net;

create or replace function public.trigger_webhook_processing()
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
    from webhook_deliveries
   where status = 'pending'
      or (status = 'failed' and attempts < max_attempts);
  if v_pending = 0 then
    return;
  end if;

  select value into v_url from app_settings where key = 'webhook_cron_endpoint';
  select value into v_secret from app_settings where key = 'cron_secret';
  if v_url is null then
    return;
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

comment on function public.trigger_webhook_processing() is
  'Every-minute pg_cron tick: pings the app webhook worker via pg_net when deliveries are claimable. No-op until app_settings.webhook_cron_endpoint is set.';

do $$
begin
  perform cron.unschedule('process-webhooks');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'process-webhooks',
  '* * * * *',
  $$select public.trigger_webhook_processing();$$
);
