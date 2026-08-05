-- Let a failed commission invoice be tried again.
--
-- invoice_status = 'failed' was a dead end: the worker only ever looked at
-- 'none', and nothing else in the codebase touches invoice_status, so one bad
-- answer from the invoicing API left that commission uninvoiced forever and
-- said nothing about it.
--
-- Retrying blindly is the other half of the trap — a failure after the invoice
-- was already created would bill the organizer twice — so the retry is bounded
-- and reconciles against the provider first (see settlement-invoicing.ts).
-- invoice_attempts is what bounds it; invoice_error keeps the last reason
-- visible instead of only in the worker log.

alter table public.settlements
  add column if not exists invoice_attempts integer not null default 0,
  add column if not exists invoice_error text;

comment on column public.settlements.invoice_attempts is
  'Invoicing attempts so far; the worker gives up after 5.';
comment on column public.settlements.invoice_error is
  'Last invoicing failure, truncated. Null once an invoice exists.';

-- The pg_cron bridge counts the work before spending a request, and its count
-- has to agree with what the worker will actually pick up. Left at
-- invoice_status = 'none' it would never wake the worker for the retries this
-- migration introduces: the queue would look empty while every settlement in it
-- was 'failed', which is exactly the silence the retry is meant to end.
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
   where invoice_status in ('none', 'failed')
     and invoice_attempts < 5
     and fee_cents > 0;
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

-- create or replace keeps the existing ACL, so the revoke from
-- 20260805120000_revoke_public_execute_on_definer_functions still holds. Stated
-- again anyway: a later drop-and-create would silently republish the function
-- over REST, and that is not something to find out from an audit.
revoke execute on function public.trigger_invoice_issuing()
  from public, anon, authenticated;
grant execute on function public.trigger_invoice_issuing() to service_role;
