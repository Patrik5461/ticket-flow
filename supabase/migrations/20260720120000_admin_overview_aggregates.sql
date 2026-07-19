-- Fix: /admin overview timed out / "Failed to fetch" because getAdminOverviewFn
-- and getPlatformStatsFn pulled EVERY paid order into the server process to
-- aggregate all-time revenue + the daily/monthly charts + top lists. That is
-- fine on a dev DB (a few orders) but on production volume it is slow enough to
-- exceed the request/proxy timeout (and PostgREST's default row cap silently
-- truncates the totals). These SECURITY DEFINER functions aggregate in the DB
-- so the response is O(1) regardless of order count. Buckets are keyed by the
-- Europe/Bratislava calendar date/month to match the JS series helpers.

create or replace function public.admin_overview_stats(p_days integer default 30)
returns json
language sql
security definer
set search_path = public
stable
as $$
  with paid as (
    select total_cents, fee_cents, coalesce(paid_at, created_at) as ts
    from public.orders
    where status = 'paid'
  ),
  today_bmba as (
    select (now() at time zone 'Europe/Bratislava')::date as d
  )
  select json_build_object(
    'grossCents', coalesce((select sum(total_cents) from paid), 0),
    'feeCents',   coalesce((select sum(fee_cents) from paid), 0),
    'paidCount',  (select count(*) from paid),
    'daily', coalesce((
      select json_agg(json_build_object('date', d, 'grossCents', g, 'orders', c) order by d)
      from (
        select to_char((ts at time zone 'Europe/Bratislava')::date, 'YYYY-MM-DD') as d,
               sum(total_cents) as g, count(*) as c
        from paid
        where (ts at time zone 'Europe/Bratislava')::date
              > (select d from today_bmba) - p_days
        group by 1
      ) x
    ), '[]'::json)
  );
$$;

create or replace function public.admin_platform_stats()
returns json
language sql
security definer
set search_path = public
stable
as $$
  with paid as (
    select o.total_cents, o.fee_cents, o.event_id,
           coalesce(o.paid_at, o.created_at) as ts,
           e.organizer_id, e.title
    from public.orders o
    left join public.events e on e.id = o.event_id
    where o.status = 'paid'
  ),
  cal as (
    select (now() at time zone 'Europe/Bratislava')::date as today,
           to_char((now() at time zone 'Europe/Bratislava')::date, 'YYYY-MM') as this_month
  )
  select json_build_object(
    'breakdown', json_build_object(
      'today', (select json_build_object(
                  'grossCents', coalesce(sum(total_cents), 0),
                  'feeCents', coalesce(sum(fee_cents), 0))
                from paid
                where (ts at time zone 'Europe/Bratislava')::date = (select today from cal)),
      'month', (select json_build_object(
                  'grossCents', coalesce(sum(total_cents), 0),
                  'feeCents', coalesce(sum(fee_cents), 0))
                from paid
                where to_char((ts at time zone 'Europe/Bratislava')::date, 'YYYY-MM') = (select this_month from cal)),
      'all',   (select json_build_object(
                  'grossCents', coalesce(sum(total_cents), 0),
                  'feeCents', coalesce(sum(fee_cents), 0))
                from paid)
    ),
    'monthly', coalesce((
      select json_agg(json_build_object('month', m, 'grossCents', g, 'feeCents', f, 'orders', c) order by m)
      from (
        select to_char((ts at time zone 'Europe/Bratislava')::date, 'YYYY-MM') as m,
               sum(total_cents) as g, sum(fee_cents) as f, count(*) as c
        from paid group by 1
      ) mm
    ), '[]'::json),
    'topOrganizers', coalesce((
      select json_agg(json_build_object('id', id, 'name', coalesce(name, '—'),
                                        'grossCents', g, 'feeCents', f) order by g desc)
      from (
        select p.organizer_id as id, max(org.name) as name,
               sum(p.total_cents) as g, sum(p.fee_cents) as f
        from paid p
        left join public.organizers org on org.id = p.organizer_id
        where p.organizer_id is not null
        group by p.organizer_id
        order by sum(p.total_cents) desc
        limit 5
      ) t
    ), '[]'::json),
    'topEvents', coalesce((
      select json_agg(json_build_object('id', id, 'title', coalesce(title, '—'),
                                        'organizerName', coalesce(orgname, '—'),
                                        'grossCents', g, 'orderCount', c) order by g desc)
      from (
        select p.event_id as id, max(p.title) as title, max(org.name) as orgname,
               sum(p.total_cents) as g, count(*) as c
        from paid p
        left join public.organizers org on org.id = p.organizer_id
        group by p.event_id
        order by sum(p.total_cents) desc
        limit 5
      ) t
    ), '[]'::json)
  );
$$;
