-- Send the commission invoice, and know whether it went.
--
-- Issuing an invoice nobody receives is not invoicing. Faktero mails it on
-- POST /invoices/{id}/send, so the worker now does that in a second pass and
-- stamps invoice_sent_at when the provider accepts it.
--
-- The stamp is what makes a failed send survivable. Sending is deliberately not
-- part of issuing: a send that fails must not put the settlement back into the
-- issuing queue, because re-issuing bills the organizer twice. Instead the row
-- stays 'created' with invoice_sent_at still null, which is exactly the
-- condition the mailing pass looks for on the next run.

alter table public.settlements
  add column if not exists invoice_sent_at timestamptz;

comment on column public.settlements.invoice_sent_at is
  'When the provider mailed the invoice; null means it still has to go out.';

-- The pg_cron bridge has to see that work too, otherwise an invoice that was
-- issued but not sent leaves a queue that looks empty and never wakes the
-- worker again.
create or replace function public.trigger_invoice_issuing()
returns void
language plpgsql
security definer
set search_path to 'public', 'net', 'extensions'
as $function$
declare
  v_url    text;
  v_secret text;
  v_todo   integer;
begin
  select count(*) into v_todo
    from settlements
   where invoice_attempts < 5
     and (
       (invoice_status in ('none', 'failed') and fee_cents > 0)
       or (invoice_status = 'created'
           and invoice_ref is not null
           and invoice_sent_at is null)
     );
  if v_todo = 0 then
    return;
  end if;

  select value into v_url from app_settings where key = 'invoice_cron_endpoint';
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
$function$;

revoke execute on function public.trigger_invoice_issuing()
  from public, anon, authenticated;
grant execute on function public.trigger_invoice_issuing() to service_role;
