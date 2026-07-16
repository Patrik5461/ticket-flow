-- Phase 7 block 3 — generic per-recipient email queue + 24h reminders.
--
-- Scheduling reminders is pure SQL (insert one job per paid order of an event
-- entering the ~24h window, deduped by a unique key so it's scheduled exactly
-- once). Sending is Node (renders the template + Resend), so a pg_cron tick pings
-- the app worker via pg_net — same bridge as refunds/invoices.

create table email_jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                    -- 'reminder' | 'bulk'
  recipient    text not null,
  event_id     uuid references events (id) on delete cascade,
  order_id     uuid references orders (id) on delete cascade,
  subject      text,                             -- set for 'bulk'; 'reminder' renders in the worker
  html         text,
  dedup_key    text,                             -- once-only semantics (unique when set)
  status       text not null default 'pending'
                 check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts     integer not null default 0,
  max_attempts integer not null default 5,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index email_jobs_dedup_uk on email_jobs (dedup_key)
  where dedup_key is not null;
create index email_jobs_status_idx on email_jobs (status);

comment on table email_jobs is
  'Per-recipient email queue. dedup_key gives once-only scheduling; drained by the app worker with bounded retries.';

alter table email_jobs enable row level security; -- server-only, no policies

-- ---------------------------------------------------------------------------
-- Enqueue a 24h reminder per paid order of every event entering the window.
-- Deduped by 'reminder:<order_id>' so re-runs (2h window, hourly cron) can't
-- double-schedule. Returns rows inserted.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_reminder_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into email_jobs (kind, recipient, event_id, order_id, dedup_key)
  select 'reminder', o.buyer_email, o.event_id, o.id, 'reminder:' || o.id
    from orders o
    join events e on e.id = o.event_id
   where o.status in ('paid', 'partially_refunded')
     and e.status = 'published'
     and e.starts_at >= now() + interval '23 hours'
     and e.starts_at <  now() + interval '25 hours'
  on conflict (dedup_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.schedule_reminder_jobs() is
  'Enqueue a 24h reminder per paid order of events in the ~24h window; deduped, so exactly once.';

revoke execute on function public.schedule_reminder_jobs() from public;
grant execute on function public.schedule_reminder_jobs() to service_role;

-- ---------------------------------------------------------------------------
-- pg_net tick: ping the app email worker when jobs are pending.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;

create or replace function public.trigger_email_processing()
returns void
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_url    text;
  v_secret text;
  v_todo   integer;
begin
  select count(*) into v_todo
    from email_jobs
   where status = 'pending'
      or (status = 'failed' and attempts < max_attempts);
  if v_todo = 0 then
    return;
  end if;

  select value into v_url from app_settings where key = 'email_cron_endpoint';
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

comment on function public.trigger_email_processing() is
  'Tick: pings the app email worker via pg_net when email_jobs are pending. No-op until app_settings.email_cron_endpoint is set.';

-- Schedule reminders hourly; drain the queue every 5 minutes.
do $$
begin
  perform cron.unschedule('schedule-reminders');
exception when others then null;
end;
$$;
select cron.schedule(
  'schedule-reminders',
  '0 * * * *',
  $$select public.schedule_reminder_jobs();$$
);

do $$
begin
  perform cron.unschedule('process-email-jobs');
exception when others then null;
end;
$$;
select cron.schedule(
  'process-email-jobs',
  '*/5 * * * *',
  $$select public.trigger_email_processing();$$
);
