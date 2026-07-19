// Phase 21 Block 2 — seat reservation concurrency test.
//
// Runs against a real Postgres (two connections) because the guarantee under
// test is DB row-lock atomicity. Sets up isolated fixtures, exercises the
// reservation functions, asserts, and ALWAYS cleans up (finally). Run with the
// pooler connection string:
//
//   PGURL='postgresql://...pooler.supabase.com:5432/postgres' node supabase/tests/seat_reservation_test.mjs
//
// Requires `npm install pg` (or `npm install pg --no-save`).

import pg from 'pg'

const PGURL = process.env.PGURL
if (!PGURL) {
  console.error('Set PGURL to the Postgres connection string.')
  process.exit(2)
}

const mk = () => new pg.Client({ connectionString: PGURL })
// The Supabase pooler occasionally rejects the first (cold) auth; retry a few
// times so a fresh run doesn't die on a transient 28P01.
async function connectRetry(client, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      await client.connect()
      return
    } catch (e) {
      if (i === tries - 1) throw e
      await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
}
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
await connectRetry(db)

// Track created ids for cleanup.
const ids = {}
const q = (c, sql, params) => c.query(sql, params)
const one = async (c, sql, params) => (await c.query(sql, params)).rows[0]

async function setup() {
  ids.org = (
    await one(
      db,
      `insert into organizers (name, slug) values ('ZZ SeatTest Org', 'zz-seattest-'||substr(md5(random()::text),1,8)) returning id`,
    )
  ).id
  ids.venue = (
    await one(
      db,
      `insert into venues (organizer_id, name) values ($1, 'ZZ SeatTest Venue') returning id`,
      [ids.org],
    )
  ).id
  ids.map = (
    await one(
      db,
      `insert into seat_maps (venue_id, name) values ($1, 'ZZ Map') returning id`,
      [ids.venue],
    )
  ).id
  ids.seatA = (
    await one(
      db,
      `insert into seats (seat_map_id, sector, row_label, seat_number) values ($1,'A','1','1') returning id`,
      [ids.map],
    )
  ).id
  ids.seatB = (
    await one(
      db,
      `insert into seats (seat_map_id, sector, row_label, seat_number) values ($1,'A','1','2') returning id`,
      [ids.map],
    )
  ).id
  ids.event = (
    await one(
      db,
      `insert into events (organizer_id, title, slug, starts_at, status)
       values ($1,'ZZ SeatTest Event','zz-seattest-'||substr(md5(random()::text),1,8), now()+interval '30 days','published') returning id`,
      [ids.org],
    )
  ).id
  // seated type, capacity = 2 seats
  ids.tt = (
    await one(
      db,
      `insert into ticket_types (event_id, name, price_cents, capacity, seated) values ($1,'Seated',2000,2,true) returning id`,
      [ids.event],
    )
  ).id
  // unseated type (to verify the cron doesn't double-decrement)
  ids.ttUnseated = (
    await one(
      db,
      `insert into ticket_types (event_id, name, price_cents, capacity, seated) values ($1,'Standing',1000,100,false) returning id`,
      [ids.event],
    )
  ).id
  await q(
    db,
    `insert into event_seat_maps (event_id, seat_map_id) values ($1,$2)`,
    [ids.event, ids.map],
  )
  await q(
    db,
    `insert into event_seats (event_id, seat_id, ticket_type_id, status) values ($1,$2,$3,'available'),($1,$4,$3,'available')`,
    [ids.event, ids.seatA, ids.tt, ids.seatB],
  )
  // orders for claims
  for (const key of ['orderA', 'orderB', 'orderC', 'orderExp']) {
    ids[key] = (
      await one(
        db,
        `insert into orders (event_id, buyer_email, status, expires_at) values ($1,'zz@test.sk','pending', now()+interval '15 min') returning id`,
        [ids.event],
      )
    ).id
  }
}

const soldCount = async () =>
  Number((await one(db, `select sold_count from ticket_types where id=$1`, [ids.tt])).sold_count)
const seatStatus = async (seatId) =>
  (await one(db, `select status, order_id from event_seats where event_id=$1 and seat_id=$2`, [ids.event, seatId]))

async function run() {
  console.log('=== Test 1: concurrent claim of the SAME seat — exactly one wins ===')
  const a = mk(), b = mk()
  await connectRetry(a);
  await connectRetry(b)
  await q(a, 'begin'); await q(b, 'begin')
  // A claims seatA and holds the row lock (uncommitted)
  const aRes = (await one(a, `select claim_seats($1, array[$2]::uuid[], $3, 15) as ok`, [ids.event, ids.seatA, ids.orderA])).ok
  // B tries the same seat — this blocks on A's row lock; issue without awaiting
  const bPromise = one(b, `select claim_seats($1, array[$2]::uuid[], $3, 15) as ok`, [ids.event, ids.seatA, ids.orderB])
  await new Promise((r) => setTimeout(r, 400)) // let B block on the lock
  await q(a, 'commit')                          // A wins, releases lock
  const bRes = (await bPromise).ok              // B now re-checks → false
  await q(b, 'commit')
  await a.end(); await b.end()
  ok('A claim succeeded', aRes === true)
  ok('B claim failed (no double-book)', bRes === false, `got ${bRes}`)
  const s1 = await seatStatus(ids.seatA)
  ok('seatA held by exactly A', s1.status === 'held' && s1.order_id === ids.orderA, JSON.stringify(s1))
  ok('sold_count = 1 after one claim', (await soldCount()) === 1)

  console.log('=== Test 2: all-or-nothing — [held seatA, free seatB] → false, seatB untouched ===')
  const c2 = (await one(db, `select claim_seats($1, array[$2,$3]::uuid[], $4, 15) as ok`, [ids.event, ids.seatA, ids.seatB, ids.orderC])).ok
  ok('mixed claim rejected', c2 === false, `got ${c2}`)
  ok('seatB still available (undo worked)', (await seatStatus(ids.seatB)).status === 'available')
  ok('sold_count unchanged = 1', (await soldCount()) === 1)

  console.log('=== Test 3: mark_seats_sold on payment ===')
  const sold = Number((await one(db, `select mark_seats_sold($1) as n`, [ids.orderA])).n)
  ok('1 seat marked sold', sold === 1)
  ok('seatA now sold', (await seatStatus(ids.seatA)).status === 'sold')
  ok('sold_count still 1 (already counted at hold)', (await soldCount()) === 1)

  console.log('=== Test 4: release_seats_for_order (refund/cancel) ===')
  const rel = Number((await one(db, `select release_seats_for_order($1) as n`, [ids.orderA])).n)
  ok('1 seat released', rel === 1)
  ok('seatA available again', (await seatStatus(ids.seatA)).status === 'available')
  ok('sold_count back to 0', (await soldCount()) === 0)

  console.log('=== Test 5: release_expired_orders frees held seats + no double-count for unseated ===')
  // Hold seatA via orderExp, add an unseated order_item, expire the order, sweep.
  await q(db, `select claim_seats($1, array[$2]::uuid[], $3, 15)`, [ids.event, ids.seatA, ids.orderExp])
  await q(db, `insert into order_items (order_id, ticket_type_id, quantity, unit_price_cents) values ($1,$2,5,1000)`, [ids.orderExp, ids.ttUnseated])
  await q(db, `update ticket_types set sold_count = sold_count + 5 where id=$1`, [ids.ttUnseated]) // unseated reserve
  await q(db, `update orders set expires_at = now() - interval '1 min' where id=$1`, [ids.orderExp])
  await q(db, `select release_expired_orders()`)
  ok('expired order seat freed', (await seatStatus(ids.seatA)).status === 'available')
  ok('seated sold_count back to 0 (via seat release)', (await soldCount()) === 0)
  const unseatedSold = Number((await one(db, `select sold_count from ticket_types where id=$1`, [ids.ttUnseated])).sold_count)
  ok('unseated sold_count back to 0 (via order_items, not doubled)', unseatedSold === 0, `got ${unseatedSold}`)
  ok('order marked expired', (await one(db, `select status from orders where id=$1`, [ids.orderExp])).status === 'expired')
}

async function cleanup() {
  // FK-safe order; event/organizer cascades handle the rest, but be explicit.
  try {
    await q(db, `delete from event_seats where event_id = $1`, [ids.event])
    await q(db, `delete from order_items where order_id = any($1::uuid[])`, [[ids.orderA, ids.orderB, ids.orderC, ids.orderExp].filter(Boolean)])
    await q(db, `delete from orders where event_id = $1`, [ids.event])
    await q(db, `delete from event_seat_maps where event_id = $1`, [ids.event])
    await q(db, `delete from ticket_types where event_id = $1`, [ids.event])
    await q(db, `delete from events where id = $1`, [ids.event])
    await q(db, `delete from seats where seat_map_id = $1`, [ids.map])
    await q(db, `delete from seat_maps where id = $1`, [ids.map])
    await q(db, `delete from venues where id = $1`, [ids.venue])
    await q(db, `delete from organizers where id = $1`, [ids.org])
  } catch (e) {
    console.log('  cleanup warning:', e.message)
  }
}

try {
  await setup()
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
