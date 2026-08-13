-- Run the commission-invoice worker hourly instead of once a month.
--
-- The schedule was '0 3 1 * *' — 03:00 on the 1st — which is the right cadence
-- for the work ARRIVING (settlements are generated an hour earlier, at 02:00 on
-- the 1st), but the wrong cadence for RETRYING it. issueSettlementInvoices()
-- retries a failed issue up to MAX_INVOICE_ATTEMPTS (5) and re-sends an invoice
-- whose mail did not go out, and both of those retries happen on the next tick.
-- With a monthly tick, "five attempts" meant five MONTHS, and one Faktero
-- hiccup at 03:00 on the 1st left the commission unbilled for thirty days.
--
-- Hourly costs nothing when there is nothing to do: trigger_invoice_issuing()
-- counts the queue first and returns without spending a net.http_post when it
-- is empty, which it is for all but a few hours a month. The generating job
-- (generate-monthly-settlements, 02:00 on the 1st) is left alone — settlements
-- should still be cut once a month.

do $$
begin
  perform cron.unschedule('issue-settlement-invoices');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'issue-settlement-invoices',
  '7 * * * *',
  $$select public.trigger_invoice_issuing();$$
);

comment on function public.trigger_invoice_issuing() is
  'Hourly pg_cron tick: pings the app to issue commission invoices for settlements without one, and to mail the ones already issued. Gated on pending work, so it is a no-op outside the few hours a month that have any. No-op until app_settings.invoice_cron_endpoint is set.';
