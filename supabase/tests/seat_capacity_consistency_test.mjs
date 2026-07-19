// Phase 21 Block 6 — seat capacity consistency + concurrency stress.
//
// Complements seat_reservation_test.mjs with the harder guarantees:
//   1. all-or-nothing under contention (N buyers race for the same block; one wins)
//   2. one-seat-per-buyer race (K seats, 2K buyers → exactly K succeed, no oversell)
//   3. capacity invariant: ticket_types.sold_count == count(held+sold event_seats)
//   4. refund releases a seat and gives sold_count back
//
// Real Postgres, full setup + guaranteed cleanup. Run:
//   npm install pg --no-save
//   PGURL='postgresql://…pooler.supabase.com:5432/postgres' node supabase/tests/seat_capacity_consistency_test.mjs

import pg from 'pg'

const PGURL = process.env.PGURL
if (!PGURL) {
  console.error('Set PGURL to the Postgres connection string.')
  process.exit(2)
}

const mk = () => new pg.Client({ connectionString: PGURL })
let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name} ${extra}`)
  }
}

const db = mk()
await db.connect()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const ids = { seats: [], orders: [] }

const soldCount = async () =>
  Number((await one(`select sold_count from ticket_types where id=$1`, [ids.tt])).sold_count)
const statusCount = async (st) =>
  Number((await one(`select count(*) c from event_seats where event_id=$1 and status=$2`, [ids.event, st])).c)

async function setup(nSeats) {
  ids.org = (await one(`insert into organizers (name, slug) values ('ZZ Cap Org','zz-cap-'||substr(md5(random()::text),1,8)) returning id`)).id
  ids.venue = (await one(`insert into venues (organizer_id, name) values ($1,'ZZ Cap Venue') returning id`, [ids.org])).id
  ids.map = (await one(`insert into seat_maps (venue_id, name) values ($1,'ZZ Cap Map') returning id`, [ids.venue])).id
  ids.event = (await one(`insert into events (organizer_id, title, slug, starts_at, status) values ($1,'ZZ Cap Event','zz-cap-'||substr(md5(random()::text),1,8), now()+interval '30 days','published') returning id`, [ids.org])).id
  ids.tt = (await one(`insert into ticket_types (event_id, name, price_cents, capacity, seated) values ($1,'Seated',1000,$2,true) returning id`, [ids.event, nSeats])).id
  await db.query(`insert into event_seat_maps (event_id, seat_map_id) values ($1,$2)`, [ids.event, ids.map])
  ids.seats = []
  for (let i = 0; i < nSeats; i++) {
    const seat = (await one(`insert into seats (seat_map_id, sector, row_label, seat_number) values ($1,'A','1',$2) returning id`, [ids.map, String(i + 1)])).id
    await db.query(`insert into event_seats (event_id, seat_id, ticket_type_id, status) values ($1,$2,$3,'available')`, [ids.event, seat, ids.tt])
    ids.seats.push(seat)
  }
}

async function newOrder() {
  const id = (await one(`insert into orders (event_id, buyer_email, status, expires_at) values ($1,'zz@test.sk','pending', now()+interval '15 min') returning id`, [ids.event])).id
  ids.orders.push(id)
  return id
}

// A claim in its own connection/transaction (so claims truly run concurrently).
async function claimInTx(seatIds, orderId) {
  const c = mk()
  await c.connect()
  try {
    await c.query('begin')
    const r = await c.query(`select claim_seats($1, $2::uuid[], $3, 15) as ok`, [ids.event, seatIds, orderId])
    await c.query('commit')
    return r.rows[0].ok === true
  } catch {
    try { await c.query('rollback') } catch { /* ignore */ }
    return false
  } finally {
    await c.end()
  }
}

async function resetSeats() {
  await db.query(`update event_seats set status='available', held_until=null, order_id=null where event_id=$1`, [ids.event])
  await db.query(`update ticket_types set sold_count=0 where id=$1`, [ids.tt])
}

async function run() {
  console.log('=== Test 1: all-or-nothing block claim under contention (5 seats, 12 buyers) ===')
  {
    const orders = await Promise.all(Array.from({ length: 12 }, () => newOrder()))
    const results = await Promise.all(orders.map((o) => claimInTx(ids.seats, o)))
    const wins = results.filter(Boolean).length
    ok('exactly one buyer got the whole block', wins === 1, `wins=${wins}`)
    ok('all 5 seats held', (await statusCount('held')) === 5)
    ok('sold_count == 5', (await soldCount()) === 5)
    ok('invariant sold_count == held+sold', (await soldCount()) === (await statusCount('held')) + (await statusCount('sold')))
    await resetSeats()
  }

  console.log('=== Test 2: one-seat-per-buyer race (5 seats, 10 buyers, 2 per seat) → exactly 5 win ===')
  {
    const attempts = []
    for (const seat of ids.seats) {
      for (let k = 0; k < 2; k++) attempts.push({ seat, order: await newOrder() })
    }
    const results = await Promise.all(attempts.map((a) => claimInTx([a.seat], a.order)))
    const wins = results.filter(Boolean).length
    ok('exactly 5 buyers won (no oversell, no under-fill)', wins === 5, `wins=${wins}`)
    ok('each seat held exactly once', (await statusCount('held')) === 5)
    ok('sold_count == 5', (await soldCount()) === 5)
    // no seat double-booked: at most one order per seat
    const dupes = Number((await one(`select count(*) c from (select seat_id, count(distinct order_id) n from event_seats where event_id=$1 and status='held' group by seat_id having count(distinct order_id) > 1) x`, [ids.event])).c)
    ok('no seat double-booked', dupes === 0)
    await resetSeats()
  }

  console.log('=== Test 3: refund releases a seat + gives sold_count back ===')
  {
    const o = await newOrder()
    await claimInTx([ids.seats[0]], o)
    await db.query(`select mark_seats_sold($1)`, [o])
    ok('1 sold', (await statusCount('sold')) === 1 && (await soldCount()) === 1)
    await db.query(`select release_seats_for_order($1)`, [o])
    ok('seat available after refund', (await statusCount('available')) === 5)
    ok('sold_count back to 0', (await soldCount()) === 0)
    await resetSeats()
  }

  console.log('=== Test 4: capacity invariant after mixed ops ===')
  {
    const o1 = await newOrder(); await claimInTx([ids.seats[0], ids.seats[1]], o1)
    const o2 = await newOrder(); await claimInTx([ids.seats[2]], o2)
    await db.query(`select mark_seats_sold($1)`, [o1])
    const invariant = (await soldCount()) === (await statusCount('held')) + (await statusCount('sold'))
    ok('sold_count == held + sold (3)', invariant && (await soldCount()) === 3)
    ok('never exceeds capacity (5)', (await soldCount()) <= 5)
    await resetSeats()
  }
}

async function cleanup() {
  try {
    await db.query(`delete from tickets where event_id=$1`, [ids.event])
    await db.query(`delete from event_seats where event_id=$1`, [ids.event])
    await db.query(`delete from order_items where order_id = any($1::uuid[])`, [ids.orders])
    await db.query(`delete from orders where event_id=$1`, [ids.event])
    await db.query(`delete from event_seat_maps where event_id=$1`, [ids.event])
    await db.query(`delete from ticket_types where event_id=$1`, [ids.event])
    await db.query(`delete from events where id=$1`, [ids.event])
    await db.query(`delete from seats where seat_map_id=$1`, [ids.map])
    await db.query(`delete from seat_maps where id=$1`, [ids.map])
    await db.query(`delete from venues where id=$1`, [ids.venue])
    await db.query(`delete from organizers where id=$1`, [ids.org])
  } catch (e) {
    console.log('  cleanup warning:', e.message)
  }
}

try {
  await setup(5)
  await run()
} catch (e) {
  fail++
  console.log('  ✗ THREW:', e.message)
} finally {
  await cleanup()
  await db.end()
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
