import { describe, it, expect } from 'vitest'
import { enqueueWebhookEvent, processWebhooks } from './webhooks'
import type { WebhookDeps } from './webhooks'

type Row = Record<string, any>
interface Store {
  webhook_endpoints: Row[]
  webhook_deliveries: Row[]
}

class Builder {
  private op: 'select' | 'update' | 'insert' = 'select'
  private values: Row = {}
  private insertRows: Row[] = []
  private eqs: [string, unknown][] = []
  private ins: [string, unknown[]][] = []

  constructor(
    private store: Store,
    private table: keyof Store,
  ) {}

  select() {
    return this
  }
  update(v: Row) {
    this.op = 'update'
    this.values = v
    return this
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert'
    this.insertRows = Array.isArray(rows) ? rows : [rows]
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

  private matched() {
    return this.store[this.table].filter(
      (r) =>
        this.eqs.every(([c, v]) => r[c] === v) &&
        this.ins.every(([c, v]) => v.includes(r[c])),
    )
  }
  private run(single: boolean) {
    if (this.op === 'insert') {
      for (const row of this.insertRows) {
        this.store[this.table].push({
          id: `row-${this.store[this.table].length + 1}`,
          ...row,
        })
      }
      return { data: null, error: null }
    }
    if (this.op === 'update') {
      const rows = this.matched()
      for (const r of rows) Object.assign(r, this.values)
      const copies = rows.map((r) => ({ ...r }))
      return single
        ? { data: copies[0] ?? null, error: null }
        : { data: copies, error: null }
    }
    const rows = this.matched().map((r) => ({ ...r }))
    return single
      ? { data: rows[0] ?? null, error: null }
      : { data: rows, error: null }
  }
  maybeSingle() {
    return Promise.resolve(this.run(true))
  }
  then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
    return Promise.resolve(this.run(false)).then(res, rej)
  }
}

function deps(
  store: Store,
  post: WebhookDeps['post'],
  posted: string[] = [],
): WebhookDeps {
  return {
    db: { from: (t: string) => new Builder(store, t as keyof Store) },
    post: async (url, body, sig) => {
      posted.push(sig)
      return post(url, body, sig)
    },
    sign: () => 'deadbeef',
    now: () => '2026-07-16T12:00:00.000Z',
    nowUnix: () => '1700000000',
  }
}

describe('enqueueWebhookEvent', () => {
  it('enqueues one delivery per subscribed, active endpoint', async () => {
    const store: Store = {
      webhook_endpoints: [
        { id: 'ep1', organizer_id: 'o1', active: true, events: ['order.paid'] },
        {
          id: 'ep2',
          organizer_id: 'o1',
          active: true,
          events: ['ticket.checked_in'],
        },
        { id: 'ep3', organizer_id: 'o1', active: true, events: ['order.paid'] },
      ],
      webhook_deliveries: [],
    }
    const n = await enqueueWebhookEvent(
      deps(store, async () => ({ status: 200 })).db,
      'o1',
      'order.paid',
      { hi: 1 },
    )
    expect(n).toBe(2)
    expect(store.webhook_deliveries.map((d) => d.endpoint_id).sort()).toEqual([
      'ep1',
      'ep3',
    ])
    expect(store.webhook_deliveries[0].status).toBe('pending')
  })

  it('returns 0 when nothing is subscribed', async () => {
    const store: Store = {
      webhook_endpoints: [
        { id: 'ep1', organizer_id: 'o1', active: true, events: [] },
      ],
      webhook_deliveries: [],
    }
    expect(
      await enqueueWebhookEvent(
        deps(store, async () => ({ status: 200 })).db,
        'o1',
        'order.paid',
        {},
      ),
    ).toBe(0)
  })
})

function delivery(id: string, over: Row = {}): Row {
  return {
    id,
    endpoint_id: 'ep1',
    event_type: 'order.paid',
    payload: { a: 1 },
    status: 'pending',
    attempts: 0,
    max_attempts: 6,
    ...over,
  }
}

describe('processWebhooks', () => {
  const base = (deliveries: Row[]): Store => ({
    webhook_endpoints: [
      { id: 'ep1', url: 'https://hook', secret: 's', active: true },
    ],
    webhook_deliveries: deliveries,
  })

  it('marks 2xx as delivered', async () => {
    const store = base([delivery('d1')])
    const res = await processWebhooks(
      deps(store, async () => ({ status: 200 })),
    )
    expect(res.delivered).toBe(1)
    expect(store.webhook_deliveries[0].status).toBe('delivered')
    expect(store.webhook_deliveries[0].attempts).toBe(1)
    expect(store.webhook_deliveries[0].response_status).toBe(200)
  })

  it('marks non-2xx as failed for retry', async () => {
    const store = base([delivery('d1')])
    const res = await processWebhooks(
      deps(store, async () => ({ status: 500 })),
    )
    expect(res.failed).toBe(1)
    expect(store.webhook_deliveries[0].status).toBe('failed')
    expect(store.webhook_deliveries[0].attempts).toBe(1)
  })

  it('treats a network error as failed', async () => {
    const store = base([delivery('d1')])
    const res = await processWebhooks(
      deps(store, async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    expect(res.failed).toBe(1)
    expect(store.webhook_deliveries[0].last_error).toContain('ECONNREFUSED')
  })

  it('stops retrying when the endpoint is inactive', async () => {
    const store = base([delivery('d1')])
    store.webhook_endpoints[0].active = false
    const res = await processWebhooks(
      deps(store, async () => ({ status: 200 })),
    )
    expect(res.failed).toBe(1)
    expect(store.webhook_deliveries[0].attempts).toBe(6) // == max_attempts
  })

  it('skips deliveries that already exhausted attempts', async () => {
    const store = base([delivery('d1', { status: 'failed', attempts: 6 })])
    const res = await processWebhooks(
      deps(store, async () => ({ status: 200 })),
    )
    expect(res.processed).toBe(0)
  })
})
