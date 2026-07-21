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

function order(
  over: Partial<{
    status: string
    total_cents: number
    fee_cents: number
    created_at: string
    paid_at: string | null
    qty: number
  }> = {},
) {
  const {
    status = 'paid',
    total_cents = 2000,
    fee_cents = 80,
    created_at = '2026-07-20T09:00:00.000Z',
    paid_at = created_at,
    qty = 2,
  } = over
  return {
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
  }
}

const load = (s: Store, organizerId = ORG) =>
  loadSalesSnapshot(EVENT_ID, organizerId, db(s), () => NOW)

describe('loadSalesSnapshot', () => {
  it("returns null for another organizer's event — nothing can stream", async () => {
    expect(await load(makeStore(), 'someone-else')).toBeNull()
  })

  it('counts only paid orders as realized revenue', async () => {
    const s = makeStore()
    s.orders.push(
      order({ total_cents: 2000, fee_cents: 80 }),
      order({ total_cents: 1000, fee_cents: 40, status: 'pending' }),
      order({ total_cents: 5000, fee_cents: 200, status: 'cancelled' }),
      order({ total_cents: 3000, fee_cents: 120, status: 'refunded' }),
      // Deliberately excluded too — buildSalesData and the page's own note
      // define realized revenue as 'paid' only; the two must agree.
      order({ total_cents: 900, fee_cents: 36, status: 'partially_refunded' }),
    )
    const snapshot = (await load(s))!
    expect(snapshot).toMatchObject({
      grossCents: 2000,
      feeCents: 80,
      netCents: 1920,
      paidOrderCount: 1,
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

  it('builds the pre-sale axis from the first order to today', async () => {
    const s = makeStore()
    s.orders.push(
      order({ created_at: '2026-07-18T09:00:00.000Z' }),
      order({ created_at: '2026-07-21T09:00:00.000Z' }),
    )
    const { series } = (await load(s))!
    // Event was on the 20th, "today" is the 22nd -> axis ends on the event day.
    expect(series.daily[0].key).toBe('2026-07-18')
    expect(series.daily[series.daily.length - 1].key).toBe('2026-07-20')
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
