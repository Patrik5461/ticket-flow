-- Phase 6 extension — manual/on-demand settlements with a per-order claim guard.
--
-- Money-safety: an order belongs to AT MOST ONE settlement, enforced by claiming
-- it (orders.settlement_id) only while it is still unclaimed. The claim UPDATE's
-- `settlement_id IS NULL` predicate + row locks make it atomic and safe against
-- concurrent generations: the second txn re-evaluates the predicate after the
-- first commits and skips the already-claimed row. Overlapping periods therefore
-- cannot double-count.

-- 1. Per-order settlement link.
alter table orders
  add column if not exists settlement_id uuid references settlements (id) on delete set null;
create index if not exists orders_settlement_idx on orders (settlement_id);

-- 2. Settlement kind / arbitrary period / creator. Monthly stays the default.
alter table settlements
  add column if not exists kind text not null default 'monthly'
    check (kind in ('monthly', 'manual', 'event')),
  add column if not exists event_id uuid references events (id) on delete set null,
  add column if not exists created_by uuid;

-- 3. period_month is monthly-only now; manual settlements have none.
alter table settlements alter column period_month drop not null;
alter table settlements drop constraint if exists settlements_organizer_id_period_month_key;
create unique index if not exists settlements_month_uniq
  on settlements (organizer_id, period_month)
  where period_month is not null;

-- 4. Backfill: link every existing settlement's orders so a later manual
--    settlement cannot re-claim (and thus double-count) them. Existing
--    settlements are monthly + non-overlapping, so this is unambiguous.
do $$
declare s record;
begin
  for s in select id, organizer_id, period_start, period_end from settlements loop
    update orders o
       set settlement_id = s.id
      from events e
     where e.id = o.event_id
       and e.organizer_id = s.organizer_id
       and o.settlement_id is null
       and o.paid_at >= s.period_start
       and o.paid_at < s.period_end
       and o.status in ('paid', 'partially_refunded', 'refunded');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- recompute_settlement: recalc gross/fee/refunded/net/order_count over the
-- orders currently claimed by the settlement. Returns the order count.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_settlement(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gross    integer;
  v_fee      integer;
  v_refunded integer;
  v_count    integer;
begin
  select coalesce(sum(o.total_cents), 0),
         coalesce(sum(o.fee_cents), 0),
         count(*)
    into v_gross, v_fee, v_count
    from orders o
   where o.settlement_id = p_id;

  select coalesce(sum(rf.amount_cents), 0)
    into v_refunded
    from refunds rf
    join orders o on o.id = rf.order_id
   where o.settlement_id = p_id
     and rf.status <> 'failed';

  update settlements
     set gross_cents    = v_gross,
         fee_cents      = v_fee,
         refunded_cents = v_refunded,
         net_cents      = v_gross - v_fee - v_refunded,
         order_count    = v_count,
         generated_at   = now()
   where id = p_id;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- generate_settlement_range: create a manual/event settlement over [from, to)
-- (optionally one event), claiming only still-unclaimed orders. Returns the new
-- settlement id, or NULL if nothing new was claimable (the empty row is removed).
-- ---------------------------------------------------------------------------
create or replace function public.generate_settlement_range(
  p_organizer uuid,
  p_from      timestamptz,
  p_to        timestamptz,
  p_kind      text,
  p_event_id  uuid,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_count integer;
begin
  insert into settlements (
    organizer_id, kind, event_id, period_month, period_start, period_end, created_by
  )
  values (p_organizer, p_kind, p_event_id, null, p_from, p_to, p_created_by)
  returning id into v_id;

  -- Atomic claim: only orders not yet in any settlement.
  update orders o
     set settlement_id = v_id
    from events e
   where e.id = o.event_id
     and e.organizer_id = p_organizer
     and o.settlement_id is null
     and o.paid_at >= p_from
     and o.paid_at < p_to
     and o.status in ('paid', 'partially_refunded', 'refunded')
     and (p_event_id is null or o.event_id = p_event_id);

  v_count := recompute_settlement(v_id);
  if v_count = 0 then
    delete from settlements where id = v_id;
    return null;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- generate_settlements (monthly) — refactored to the SAME claim model, so the
-- monthly cron and manual generation never double-count. Re-running a month now
-- claims only newly-unclaimed orders ("claim new only") instead of recomputing
-- from scratch. Returns the number of organizer settlements touched.
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
  v_org   uuid;
  v_id    uuid;
  v_count integer := 0;
begin
  for v_org in
    select distinct e.organizer_id
      from orders o
      join events e on e.id = o.event_id
     where o.paid_at >= v_start
       and o.paid_at < v_end
       and o.status in ('paid', 'partially_refunded', 'refunded')
  loop
    select id into v_id
      from settlements
     where organizer_id = v_org and period_month = p_period_month;
    if v_id is null then
      insert into settlements (
        organizer_id, kind, period_month, period_start, period_end
      )
      values (v_org, 'monthly', p_period_month, v_start, v_end)
      returning id into v_id;
    end if;

    update orders o
       set settlement_id = v_id
      from events e
     where e.id = o.event_id
       and e.organizer_id = v_org
       and o.settlement_id is null
       and o.paid_at >= v_start
       and o.paid_at < v_end
       and o.status in ('paid', 'partially_refunded', 'refunded');

    perform recompute_settlement(v_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.recompute_settlement(uuid) from public;
revoke execute on function public.generate_settlement_range(uuid, timestamptz, timestamptz, text, uuid, uuid) from public;
grant execute on function public.recompute_settlement(uuid) to service_role;
grant execute on function public.generate_settlement_range(uuid, timestamptz, timestamptz, text, uuid, uuid) to service_role;
