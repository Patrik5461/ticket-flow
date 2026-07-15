-- Phase 6 block 4 — company billing on orders + commission invoicing on settlements.

-- "Kúpiť na firmu": optional company billing details captured at checkout.
alter table orders
  add column billing_ico     text,
  add column billing_dic     text,
  add column billing_ic_dph  text,
  add column billing_name    text,
  add column billing_address text;

comment on column orders.billing_name is
  'Company name for an invoice ("kúpiť na firmu"); null for a normal consumer order.';

-- Commission-invoice tracking (Faktero). One invoice per settlement for the
-- platform commission charged to the organizer.
alter table settlements
  add column invoice_status text not null default 'none'
    check (invoice_status in ('none', 'created', 'failed')),
  add column invoice_ref    text,           -- provider invoice id/number
  add column invoiced_at    timestamptz;

comment on column settlements.invoice_status is
  'none | created | failed — state of the platform-commission invoice for this settlement.';

-- ---------------------------------------------------------------------------
-- Monthly cron: issue commission invoices for freshly generated settlements.
-- Node-side work (Faktero API), so pg_cron pings the app worker via pg_net —
-- same bridge as the refund queue. Runs an hour after settlement generation.
-- No-op until app_settings.invoice_cron_endpoint is set.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;

create or replace function public.trigger_invoice_issuing()
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
    from settlements
   where invoice_status = 'none' and fee_cents > 0;
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
$$;

comment on function public.trigger_invoice_issuing() is
  'Monthly pg_cron tick: pings the app to issue commission invoices for settlements without one. No-op until app_settings.invoice_cron_endpoint is set.';

do $$
begin
  perform cron.unschedule('issue-settlement-invoices');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'issue-settlement-invoices',
  '0 3 1 * *',
  $$select public.trigger_invoice_issuing();$$
);
