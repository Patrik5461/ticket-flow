-- Phase 6 block 3 — monthly organizer settlements.
--
-- One row per organizer per calendar month (Europe/Bratislava). Aggregation is
-- pure SQL over orders + refunds, so pg_cron runs it directly (no app bridge) on
-- the 1st of each month for the previous month. Node only reads these rows to
-- render the settlement PDF and the organizer dashboard.
--
-- Money model: an order settles in the month it was PAID. gross = collected,
-- fee = platform commission, refunded = anything refunded on those orders (any
-- time), net = gross − fee − refunded (what the organizer keeps).

create table settlements (
  id             uuid primary key default gen_random_uuid(),
  organizer_id   uuid not null references organizers (id) on delete cascade,
  period_month   date not null,               -- first day of the settled month
  period_start   timestamptz not null,
  period_end     timestamptz not null,
  gross_cents    integer not null default 0,
  fee_cents      integer not null default 0,
  refunded_cents integer not null default 0,
  net_cents      integer not null default 0,
  order_count    integer not null default 0,
  currency       text not null default 'EUR',
  status         text not null default 'generated'
                   check (status in ('generated', 'paid_out')),
  generated_at   timestamptz not null default now(),
  unique (organizer_id, period_month)
);

create index settlements_organizer_idx on settlements (organizer_id, period_month desc);

comment on table settlements is
  'Monthly per-organizer settlement: gross/fee/refunded/net over orders paid that month. net = gross − fee − refunded.';

alter table settlements enable row level security; -- server-only, no policies

-- ---------------------------------------------------------------------------
-- Generate (idempotent upsert) settlements for the month starting p_period_month.
-- Returns the number of organizer rows written.
-- ---------------------------------------------------------------------------
create or replace function public.generate_settlements(p_period_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz    text := 'Europe/Bratislava';
  v_start timestamptz := (p_period_month::timestamp) at time zone v_tz;
  v_end   timestamptz := ((p_period_month + interval '1 month')::timestamp) at time zone v_tz;
  v_count integer;
begin
  insert into settlements as s (
    organizer_id, period_month, period_start, period_end,
    gross_cents, fee_cents, refunded_cents, net_cents, order_count
  )
  select e.organizer_id,
         p_period_month,
         v_start,
         v_end,
         coalesce(sum(o.total_cents), 0),
         coalesce(sum(o.fee_cents), 0),
         coalesce(sum(r.refunded), 0),
         coalesce(sum(o.total_cents), 0)
           - coalesce(sum(o.fee_cents), 0)
           - coalesce(sum(r.refunded), 0),
         count(*)
    from orders o
    join events e on e.id = o.event_id
    left join lateral (
      select coalesce(sum(rf.amount_cents), 0) as refunded
        from refunds rf
       where rf.order_id = o.id
         and rf.status <> 'failed'
    ) r on true
   where o.paid_at >= v_start
     and o.paid_at < v_end
     and o.status in ('paid', 'partially_refunded', 'refunded')
   group by e.organizer_id
  on conflict (organizer_id, period_month) do update
    set gross_cents    = excluded.gross_cents,
        fee_cents      = excluded.fee_cents,
        refunded_cents = excluded.refunded_cents,
        net_cents      = excluded.net_cents,
        order_count    = excluded.order_count,
        period_start   = excluded.period_start,
        period_end     = excluded.period_end,
        generated_at   = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.generate_settlements(date) is
  'Idempotently upsert per-organizer settlements for the given month. Returns rows written.';

-- Previous calendar month (in Bratislava time), for the monthly cron.
create or replace function public.generate_previous_month_settlements()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev date := (
    date_trunc('month', (now() at time zone 'Europe/Bratislava')) - interval '1 month'
  )::date;
begin
  return public.generate_settlements(v_prev);
end;
$$;

revoke execute on function public.generate_settlements(date) from public;
revoke execute on function public.generate_previous_month_settlements() from public;
grant execute on function public.generate_settlements(date) to service_role;
grant execute on function public.generate_previous_month_settlements() to service_role;

-- Run at 02:00 on the 1st of every month for the previous month.
do $$
begin
  perform cron.unschedule('generate-monthly-settlements');
exception
  when others then null;
end;
$$;

select cron.schedule(
  'generate-monthly-settlements',
  '0 2 1 * *',
  $$select public.generate_previous_month_settlements();$$
);
