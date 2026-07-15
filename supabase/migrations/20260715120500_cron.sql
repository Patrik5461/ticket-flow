-- Schedule the reservation-release job to run every minute.
-- Idempotent: unschedule any prior job of the same name before (re)creating it,
-- so re-running migrations does not create duplicates.

do $$
begin
  perform cron.unschedule('release-expired-orders');
exception
  when others then
    null;  -- job did not exist yet
end;
$$;

select cron.schedule(
  'release-expired-orders',
  '* * * * *',
  $$select public.release_expired_orders();$$
);
