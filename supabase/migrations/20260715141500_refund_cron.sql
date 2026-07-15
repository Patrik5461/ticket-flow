-- Phase 6 block 2 — pg_cron trigger for the refund queue.
--
-- pg_cron is SQL-only, but refunds run in Node (GoPay + email). The bridge:
-- every minute a tick checks for claimable refund_jobs and, if any, POSTs to the
-- app's /api/cron/process-refunds endpoint via pg_net. Endpoint URL + shared
-- secret live in app_settings (seeded outside migrations), so nothing sensitive
-- is committed and the tick is a safe no-op until the app is deployed + settings
-- are set.
--
-- pg_net is enabled by default on Supabase cloud. If this migration fails on
-- `create extension pg_net`, enable it once in Dashboard → Database → Extensions
-- and re-run `npx supabase db push`. The refund_jobs table (previous migration)
-- and the inline drain on cancel work regardless.

create extension if not exists pg_net;

create or replace function public.trigger_refund_processing()
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
    from refund_jobs
   where status = 'pending'
      or (status = 'failed' and attempts < max_attempts);
  if v_pending = 0 then
    return;
  end if;

  select value into v_url from app_settings where key = 'cron_endpoint';
  select value into v_secret from app_settings where key = 'cron_secret';
  if v_url is null then
    return; -- not configured yet (e.g. local dev) — nothing to ping
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

comment on function public.trigger_refund_processing() is
  'Every-minute pg_cron tick: pings the app refund worker via pg_net when refund_jobs are pending. No-op until app_settings.cron_endpoint is set.';

do $$
begin
  perform cron.unschedule('process-refund-jobs');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'process-refund-jobs',
  '* * * * *',
  $$select public.trigger_refund_processing();$$
);
