import { describe, it, expect } from 'vitest'
import { getEvent, listOrders, listEventTickets } from './api-v1'

/**
 * Penetration self-test: the public API must never leak another organizer's
 * data. Every scoped query is checked against a foreign organizer_id.
 */

type Row = Record<string, any>
interface Store {
  events: Row[]
  ticket_types: Row[]
  orders: Row[]
  tickets: Row[]
}

class Builder {
  private eqs: [string, unknown][] = []
  private ins: [string, unknown[]][] = []
  constructor(
    private store: Store,
    private table: keyof Store,
  ) {}
  select() {
    return this
  }
  eq(c: string, v: unknown) {
    this.eqs.push([c, v])
    return this
  }
  in(c: string, v: unknown[]) {
    this.ins.push([c, v])
    return this
  }
  order() {
    return this
  }
  range() {
    return this
  }
  private matched() {
    return this.store[this.table].filter(
      (r) =>
        this.eqs.every(([c, v]) => r[c] === v) &&
        this.ins.every(([c, v]) => v.includes(r[c])),
    )
  }
  maybeSingle() {
    return Promise.resolve({ data: this.matched()[0] ?? null, error: null })
  }
  then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
    return Promise.resolve({ data: this.matched(), error: null }).then(res, rej)
  }
}

const store = (): Store => ({
  events: [
    {
      id: 'ev-a',
      organizer_id: 'org-a',
      slug: 'a',
      title: 'A',
      status: 'published',
      starts_at: 't',
      timezone: 'Europe/Bratislava',
    },
    {
      id: 'ev-b',
      organizer_id: 'org-b',
      slug: 'b',
      title: 'B',
      status: 'published',
      starts_at: 't',
      timezone: 'Europe/Bratislava',
    },
  ],
  ticket_types: [
    {
      id: 'tt-a',
      event_id: 'ev-a',
      name: 'X',
      price_cents: 100,
      capacity: 10,
      sold_count: 0,
    },
  ],
  orders: [
    {
      id: 'or-a',
      event_id: 'ev-a',
      status: 'paid',
      buyer_email: 'a@x.sk',
      total_cents: 100,
      created_at: 't',
    },
    {
      id: 'or-b',
      event_id: 'ev-b',
      status: 'paid',
      buyer_email: 'b@x.sk',
      total_cents: 100,
      created_at: 't',
    },
  ],
  tickets: [
    {
      id: 'ti-a',
      order_id: 'or-a',
      ticket_type_id: 'tt-a',
      event_id: 'ev-a',
      status: 'valid',
    },
  ],
})

const db = (s: Store) => ({
  from: (t: string) => new Builder(s, t as keyof Store),
})

describe('cross-organizer isolation', () => {
  it('getEvent hides a foreign organizer’s event', async () => {
    expect(await getEvent(db(store()), 'org-b', 'ev-a')).toBeNull()
  })

  it('getEvent returns the owned event with its ticket types', async () => {
    const ev = await getEvent(db(store()), 'org-a', 'ev-a')
    expect(ev?.id).toBe('ev-a')
    expect((ev?.ticket_types as any[]).length).toBe(1)
  })

  it('listOrders returns only the organizer’s orders', async () => {
    const orders = await listOrders(db(store()), 'org-a', {
      limit: 50,
      offset: 0,
    })
    expect(orders.map((o) => o.id)).toEqual(['or-a'])
  })

  it('listOrders is empty for an organizer with no events', async () => {
    expect(
      await listOrders(db(store()), 'org-x', { limit: 50, offset: 0 }),
    ).toEqual([])
  })

  it('listEventTickets hides a foreign event’s tickets', async () => {
    expect(
      await listEventTickets(db(store()), 'org-b', 'ev-a', {
        limit: 50,
        offset: 0,
      }),
    ).toBeNull()
  })

  it('listEventTickets returns tickets for the owned event', async () => {
    const t = await listEventTickets(db(store()), 'org-a', 'ev-a', {
      limit: 50,
      offset: 0,
    })
    expect(t?.map((x) => x.id)).toEqual(['ti-a'])
  })
})
