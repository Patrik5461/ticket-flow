-- Money-safe test: an order is counted in EXACTLY ONE settlement across manual +
-- monthly generation, and Σ(settlement net) = Σ(order net). Non-destructive —
-- wrapped in BEGIN ... ROLLBACK, so it leaves no data behind.
--
-- Run on a dev/staging DB (NOT via the app):
--   psql "$DATABASE_URL" -f supabase/tests/manual_settlements_moneysafe.sql
-- Prints NOTICE 'MONEY-SAFE OK ...' on success; RAISES on any double-count.

begin;

do $$
declare
  v_org    uuid := gen_random_uuid();
  v_ev     uuid := gen_random_uuid();
  v_sfx    text := substr(md5(random()::text), 1, 8);
  v_manual uuid;
  v_claimed_manual int;
  v_unclaimed int;
  v_settle_net int;
  v_orders_net int;
begin
  insert into organizers (id, name, slug)
    values (v_org, 'MS TEST', 'ms-test-' || v_sfx);
  insert into events (id, organizer_id, title, slug, starts_at, timezone, status)
    values (v_ev, v_org, 'MS TEST EV', 'ms-ev-' || v_sfx,
            '2026-01-15 18:00+01', 'Europe/Bratislava', 'published');
  -- (qr_secret is uuid with a default; leave it to default)

  -- 3 paid orders in January 2026 (two inside 5–20 Jan, one on 25 Jan).
  insert into orders (event_id, buyer_email, status, subtotal_cents, total_cents, fee_cents, paid_at, payment_method)
  values
    (v_ev, 'a@x.sk', 'paid', 1000, 1000, 40, '2026-01-10 12:00+01', 'manual'),
    (v_ev, 'b@x.sk', 'paid', 2000, 2000, 80, '2026-01-12 12:00+01', 'manual'),
    (v_ev, 'c@x.sk', 'paid',  500,  500, 40, '2026-01-25 12:00+01', 'manual');

  -- 1) Manual settlement for [5 Jan, 20 Jan) — claims the two orders in that window.
  v_manual := generate_settlement_range(
    v_org, '2026-01-05 00:00+01', '2026-01-20 00:00+01', 'manual', null, null);

  select count(*) into v_claimed_manual from orders where settlement_id = v_manual;
  if v_claimed_manual <> 2 then
    raise exception 'expected 2 claimed by manual, got %', v_claimed_manual;
  end if;

  -- 2) Monthly settlement for January — must claim ONLY the remaining 1 (never re-claim).
  perform generate_settlements('2026-01-01');

  -- 3) Every paid order claimed exactly once (settlement_id is a single column, so a
  --    double claim is impossible by construction; verify none left unclaimed).
  select count(*) into v_unclaimed
    from orders where event_id = v_ev and status = 'paid' and settlement_id is null;
  if v_unclaimed <> 0 then
    raise exception '% paid orders left unclaimed', v_unclaimed;
  end if;

  -- 4) Σ(settlement net) == Σ(order total - fee) over the paid orders.
  select coalesce(sum(net_cents), 0) into v_settle_net
    from settlements where organizer_id = v_org;
  select coalesce(sum(total_cents - fee_cents), 0) into v_orders_net
    from orders where event_id = v_ev and status = 'paid';
  if v_settle_net <> v_orders_net then
    raise exception 'net mismatch: settlements=% orders=%', v_settle_net, v_orders_net;
  end if;

  raise notice 'MONEY-SAFE OK: each order claimed once; net settlements=% = orders=%',
    v_settle_net, v_orders_net;
end $$;

rollback;
