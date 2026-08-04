import { describe, it, expect } from 'vitest'
import { loadSalesSnapshot, snapshotSignature } from './sales-live'
import type { SalesLiveDb } from './sales-live'

// ---------------------------------------------------------------------------
// Fake of the chains this module uses:
//   events:  select().eq().eq().maybeSingle()
//   orders:  select().eq()                      (awaited)
//   tickets: select(count, head).eq().neq()/.eq()
// ---------------------------------------------------------------------------

interface Store {
  events: Record<string, unknown>[]
  orders: Record<string, unknown>[]
  tickets: Record<string, unknown>[]
  refunds: Record<string, unknown>[]
}

class Builder {
  private eqs: [string, unknown][] = []
  private neqs: [string, unknown][] = []
  private countMode = false

  constructor(
    private store: Store,
    private table: keyof Store,
  ) {}

  select(_cols?: unknown, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.countMode = true
    return this
  }
  eq(col: string, val: unknown) {
    this.eqs.push([col, val])
    return this
  }
  neq(col: string, val: unknown) {
    this.neqs.push([col, val])
    return this
  }

  private matched() {
    return this.store[this.table].filter(
      (row) =>
        this.eqs.every(([c, v]) => row[c] === v) &&
        this.neqs.every(([c, v]) => row[c] !== v),
    )
  }

  maybeSingle() {
    return Promise.resolve({ data: this.matched()[0] ?? null, error: null })
  }
  then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
    const rows = this.matched()
    const payload = this.countMode
      ? { data: null, count: rows.length, error: null }
      : { data: rows, error: null }
    return Promise.resolve(payload).then(resolve, reject)
  }
}

const db = (s: Store): SalesLiveDb => ({
  from: (table: string) => new Builder(s, table as keyof Store),
})

const ORG = 'org-1'
const EVENT_ID = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-07-22T10:00:00.000Z'

let orderSeq = 0
function order(
  over: Partial<{
    id: string
    status: string
    total_cents: number
    fee_cents: number
    created_at: string
    paid_at: string | null
    qty: number
  }> = {},
) {
  const {
    id = `order-${++orderSeq}`,
    status = 'paid',
    total_cents = 2000,
    fee_cents = 80,
    created_at = '2026-07-20T09:00:00.000Z',
    paid_at = created_at,
    qty = 2,
  } = over
  return {
    id,
    event_id: EVENT_ID,
    status,
    total_cents,
    fee_cents,
    created_at,
    paid_at,
    order_items: [{ quantity: qty }],
  }
}

function makeStore(): Store {
  return {
    events: [
      {
        id: EVENT_ID,
        organizer_id: ORG,
        // 20 July 2026, 20:00 local (CEST) — the event day.
        starts_at: '2026-07-20T18:00:00.000Z',
        timezone: 'Europe/Bratislava',
      },
    ],
    orders: [],
    tickets: [],
    refunds: [],
  }
}

const load = (s: Store, organizerId = ORG) =>
  loadSalesSnapshot(EVENT_ID, organizerId, db(s), () => NOW)

describe('loadSalesSnapshot', () => {
  it("returns null for another organizer's event — nothing can stream", async () => {
    expect(await load(makeStore(), 'someone-else')).toBeNull()
  })

  it('gross covers every order whose money was collected; unpaid excluded', async () => {
    const s = makeStore()
    s.orders.push(
      order({ id: 'o1', total_cents: 2000, fee_cents: 80 }),
      order({ total_cents: 1000, fee_cents: 40, status: 'pending' }), // excluded
      order({ total_cents: 5000, fee_cents: 200, status: 'cancelled' }), // excluded
      order({
        id: 'o2',
        total_cents: 3000,
        fee_cents: 120,
        status: 'refunded',
      }),
      order({
        id: 'o3',
        total_cents: 900,
        fee_cents: 36,
        status: 'partially_refunded',
      }),
    )
    const snapshot = (await load(s))!
    // paid + refunded + partially_refunded = 2000 + 3000 + 900.
    expect(snapshot).toMatchObject({
      grossCents: 5900,
      feeCents: 236,
      refundedCents: 0,
      netCents: 5664,
      paidOrderCount: 3,
    })
  })

  it('nets refunds: net = gross − fee − refunded, fee kept on refund', async () => {
    const s = makeStore()
    s.orders.push(
      order({
        id: 'o1',
        total_cents: 3000,
        fee_cents: 120,
        status: 'refunded',
      }),
      order({
        id: 'o2',
        total_cents: 2000,
        fee_cents: 80,
        status: 'partially_refunded',
      }),
    )
    s.refunds.push(
      {
        order_id: 'o1',
        event_id: EVENT_ID,
        ticket_id: null,
        amount_cents: 3000,
        status: 'done',
        created_at: '2026-07-21T10:00:00.000Z',
      },
      {
        order_id: 'o2',
        event_id: EVENT_ID,
        ticket_id: 't1',
        amount_cents: 500,
        status: 'done',
        created_at: '2026-07-21T11:00:00.000Z',
      },
      // A failed refund never moved money — must not count.
      {
        order_id: 'o2',
        event_id: EVENT_ID,
        ticket_id: 't2',
        amount_cents: 700,
        status: 'failed',
        created_at: '2026-07-21T12:00:00.000Z',
      },
    )
    const snapshot = (await load(s))!
    expect(snapshot).toMatchObject({
      grossCents: 5000,
      feeCents: 200,
      refundedCents: 3500, // 3000 + 500, the failed 700 excluded
      netCents: 1300, // 5000 − 200 − 3500 — platform kept the full fee
    })
  })

  it('counts issued tickets without cancelled ones, and admitted ones', async () => {
    const s = makeStore()
    s.tickets.push(
      { event_id: EVENT_ID, status: 'valid' },
      { event_id: EVENT_ID, status: 'used' },
      { event_id: EVENT_ID, status: 'used' },
      { event_id: EVENT_ID, status: 'cancelled' },
    )
    const snapshot = (await load(s))!
    expect(snapshot.ticketCount).toBe(3)
    expect(snapshot.checkedIn).toBe(2)
  })

  it('buckets the event day by LOCAL hour and sums tickets sold', async () => {
    const s = makeStore()
    s.orders.push(
      // 09:00 UTC = 11:00 Bratislava (CEST)
      order({ created_at: '2026-07-20T09:00:00.000Z', qty: 2 }),
      order({ created_at: '2026-07-20T09:40:00.000Z', qty: 1 }),
      // 22:30 local — the late bucket
      order({ created_at: '2026-07-20T20:30:00.000Z', qty: 3 }),
    )
    const { series } = (await load(s))!

    expect(series.eventDay).toBe('2026-07-20')
    expect(series.timezone).toBe('Europe/Bratislava')
    expect(series.hourly).toHaveLength(24)

    const at11 = series.hourly.find((p) => p.label === '11:00')!
    expect(at11).toMatchObject({ orders: 2, tickets: 3, grossCents: 4000 })
    expect(series.hourly.find((p) => p.label === '22:00')!.tickets).toBe(3)
  })

  it('spans the pre-sale axis across every money movement, incl. post-event', async () => {
    const s = makeStore()
    s.orders.push(
      order({ created_at: '2026-07-18T09:00:00.000Z' }),
      // A sale after the event day (20th) must still appear — not be dropped.
      order({ created_at: '2026-07-21T09:00:00.000Z' }),
    )
    const { series } = (await load(s))!
    expect(series.daily[0].key).toBe('2026-07-18')
    expect(series.daily[series.daily.length - 1].key).toBe('2026-07-21')
  })

  it('subtracts a refund in the bucket of the refund day, not the sale day', async () => {
    const s = makeStore()
    s.orders.push(
      order({
        id: 'o1',
        total_cents: 5000,
        qty: 2,
        status: 'partially_refunded',
        created_at: '2026-07-18T09:00:00.000Z',
      }),
    )
    s.refunds.push({
      order_id: 'o1',
      event_id: EVENT_ID,
      ticket_id: 't1', // single-ticket refund → cancels 1 ticket
      amount_cents: 2500,
      status: 'done',
      created_at: '2026-07-19T09:00:00.000Z',
    })
    const { series } = (await load(s))!
    const byKey = Object.fromEntries(series.daily.map((p) => [p.key, p]))
    // Sale day: full positive.
    expect(byKey['2026-07-18']).toMatchObject({ grossCents: 5000, tickets: 2 })
    // Refund day: the negative movement lands here.
    expect(byKey['2026-07-19']).toMatchObject({
      grossCents: -2500,
      tickets: -1,
    })
  })

  it('a failed refund never appears on the chart', async () => {
    const s = makeStore()
    s.orders.push(
      order({
        id: 'o1',
        total_cents: 5000,
        created_at: '2026-07-18T09:00:00.000Z',
      }),
    )
    s.refunds.push({
      order_id: 'o1',
      event_id: EVENT_ID,
      ticket_id: 't1',
      amount_cents: 2500,
      status: 'failed',
      created_at: '2026-07-19T09:00:00.000Z',
    })
    const { series } = (await load(s))!
    // The failed refund is not a money movement, so it never appears — neither
    // as its own bucket nor as a negative anywhere.
    const total = series.daily.reduce((sum, p) => sum + p.grossCents, 0)
    expect(total).toBe(5000)
    expect(series.daily.every((p) => p.grossCents >= 0)).toBe(true)
  })

  it('a whole-order refund subtracts the order’s full ticket count', async () => {
    const s = makeStore()
    s.orders.push(
      order({
        id: 'o1',
        total_cents: 6000,
        qty: 3,
        status: 'refunded',
        created_at: '2026-07-20T09:00:00.000Z',
      }),
    )
    s.refunds.push({
      order_id: 'o1',
      event_id: EVENT_ID,
      ticket_id: null, // whole-order → all 3 tickets
      amount_cents: 6000,
      status: 'done',
      created_at: '2026-07-20T12:00:00.000Z',
    })
    const { series } = (await load(s))!
    // Both land on the event day (20th); the hourly view shows the split.
    const at11 = series.hourly.find((p) => p.label === '11:00')!
    const at14 = series.hourly.find((p) => p.label === '14:00')!
    expect(at11).toMatchObject({ grossCents: 6000, tickets: 3 })
    expect(at14).toMatchObject({ grossCents: -6000, tickets: -3 })
  })

  it('excludes unpaid orders from the chart, exactly like the totals', async () => {
    const s = makeStore()
    s.orders.push(
      order({ created_at: '2026-07-20T09:00:00.000Z', status: 'pending' }),
    )
    const { series, grossCents } = (await load(s))!
    expect(grossCents).toBe(0)
    expect(series.hourly.every((p) => p.orders === 0)).toBe(true)
  })

  it('handles an event with no orders at all', async () => {
    const snapshot = (await load(makeStore()))!
    expect(snapshot).toMatchObject({
      grossCents: 0,
      paidOrderCount: 0,
      ticketCount: 0,
      checkedIn: 0,
    })
    expect(snapshot.series.hourly).toHaveLength(24)
    expect(snapshot.series.daily.length).toBeGreaterThan(0)
  })
})

describe('snapshotSignature', () => {
  it('changes when a new order is paid — this is what makes the stream push', async () => {
    const s = makeStore()
    s.orders.push(order())
    const before = snapshotSignature((await load(s))!)

    s.orders.push(order({ total_cents: 1500, fee_cents: 60 }))
    const after = snapshotSignature((await load(s))!)

    expect(after).not.toBe(before)
  })

  it('changes when a ticket is checked in', async () => {
    const s = makeStore()
    s.tickets.push({ event_id: EVENT_ID, status: 'valid' })
    const before = snapshotSignature((await load(s))!)

    s.tickets[0].status = 'used'
    const after = snapshotSignature((await load(s))!)

    expect(after).not.toBe(before)
  })

  it('ignores the timestamp, so an idle event pushes nothing', async () => {
    const s = makeStore()
    s.orders.push(order())
    const a = await loadSalesSnapshot(EVENT_ID, ORG, db(s), () => NOW)
    const b = await loadSalesSnapshot(
      EVENT_ID,
      ORG,
      db(s),
      () => '2026-07-22T10:00:04.000Z',
    )
    expect(a!.at).not.toBe(b!.at)
    expect(snapshotSignature(a!)).toBe(snapshotSignature(b!))
  })
})
