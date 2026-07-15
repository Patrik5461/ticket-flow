import { describe, it, expect } from 'vitest'
import { enqueueEventRefundJobs, processRefundJobs } from './refund-jobs'
import type { RefundJobsDeps } from './refund-jobs'

interface Store {
  orders: Record<string, any>[]
  refund_jobs: Record<string, any>[]
}

class Builder {
  private op: 'select' | 'update' | 'upsert' = 'select'
  private mutated = false
  private values: Record<string, unknown> = {}
  private upsertRows: Record<string, unknown>[] = []
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  private eqs: [string, unknown][] = []
  private neqs: [string, unknown][] = []
  private ins: [string, unknown[]][] = []

  constructor(
    private store: Store,
    private table: keyof Store,
  ) {}

  select() {
    if (!this.mutated) this.op = 'select'
    return this
  }
  update(v: Record<string, unknown>) {
    this.op = 'update'
    this.mutated = true
    this.values = v
    return this
  }
  upsert(rows: Record<string, unknown>[], opts: any) {
    this.op = 'upsert'
    this.mutated = true
    this.upsertRows = rows
    this.upsertOpts = opts ?? {}
    return this
  }
  eq(c: string, v: unknown) {
    this.eqs.push([c, v])
    return this
  }
  neq(c: string, v: unknown) {
    this.neqs.push([c, v])
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
        this.neqs.every(([c, v]) => r[c] !== v) &&
        this.ins.every(([c, v]) => v.includes(r[c])),
    )
  }
  private run(single: boolean) {
    if (this.op === 'upsert') {
      const key = this.upsertOpts.onConflict
      for (const row of this.upsertRows) {
        if (
          key &&
          this.upsertOpts.ignoreDuplicates &&
          this.store[this.table].some((r) => r[key] === (row as any)[key])
        ) {
          continue
        }
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

function makeDeps(
  store: Store,
  refundOrder: (orderId: string) => Promise<void>,
): RefundJobsDeps {
  return {
    db: { from: (t: string) => new Builder(store, t as keyof Store) },
    refundOrder,
    now: () => '2026-07-15T18:00:00.000Z',
  }
}

const EVENT = 'e1'

describe('enqueueEventRefundJobs', () => {
  it('enqueues one job per paid/partially_refunded order, ignoring others', async () => {
    const store: Store = {
      orders: [
        { id: 'o1', event_id: EVENT, status: 'paid' },
        { id: 'o2', event_id: EVENT, status: 'partially_refunded' },
        { id: 'o3', event_id: EVENT, status: 'pending' },
        { id: 'o4', event_id: 'other', status: 'paid' },
      ],
      refund_jobs: [],
    }
    const n = await enqueueEventRefundJobs(
      makeDeps(store, async () => {}),
      EVENT,
    )
    expect(n).toBe(2)
    expect(store.refund_jobs.map((j) => j.order_id).sort()).toEqual([
      'o1',
      'o2',
    ])
  })

  it('is idempotent — a re-enqueue adds no duplicate jobs', async () => {
    const store: Store = {
      orders: [{ id: 'o1', event_id: EVENT, status: 'paid' }],
      refund_jobs: [],
    }
    const deps = makeDeps(store, async () => {})
    await enqueueEventRefundJobs(deps, EVENT)
    await enqueueEventRefundJobs(deps, EVENT)
    expect(store.refund_jobs).toHaveLength(1)
  })
})

function job(id: string, over: Partial<Record<string, any>> = {}) {
  return {
    id,
    order_id: `ord-${id}`,
    event_id: EVENT,
    status: 'pending',
    attempts: 0,
    max_attempts: 5,
    ...over,
  }
}

describe('processRefundJobs', () => {
  it('refunds each order and marks jobs done', async () => {
    const store: Store = { orders: [], refund_jobs: [job('j1'), job('j2')] }
    const refunded: string[] = []
    const res = await processRefundJobs(
      makeDeps(store, async (orderId) => {
        refunded.push(orderId)
      }),
    )
    expect(res).toEqual({ processed: 2, done: 2, failed: 0 })
    expect(refunded.sort()).toEqual(['ord-j1', 'ord-j2'])
    expect(store.refund_jobs.every((j) => j.status === 'done')).toBe(true)
    expect(store.refund_jobs.every((j) => j.attempts === 1)).toBe(true)
  })

  it('marks a job failed (with the error) when the refund throws, and retries later', async () => {
    const store: Store = { orders: [], refund_jobs: [job('j1')] }
    let calls = 0
    const deps = makeDeps(store, async () => {
      calls++
      if (calls === 1) throw new Error('gateway down')
    })

    const first = await processRefundJobs(deps)
    expect(first).toEqual({ processed: 1, done: 0, failed: 1 })
    expect(store.refund_jobs[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      last_error: 'gateway down',
    })

    // A failed job under max_attempts is retried on the next tick.
    const second = await processRefundJobs(deps)
    expect(second).toEqual({ processed: 1, done: 1, failed: 0 })
    expect(store.refund_jobs[0]).toMatchObject({ status: 'done', attempts: 2 })
  })

  it('skips jobs that reached max_attempts and honours the batch limit', async () => {
    const store: Store = {
      orders: [],
      refund_jobs: [
        job('done', { status: 'done' }),
        job('exhausted', { status: 'failed', attempts: 5, max_attempts: 5 }),
        job('j1'),
        job('j2'),
        job('j3'),
      ],
    }
    const res = await processRefundJobs(
      makeDeps(store, async () => {}),
      {
        limit: 2,
      },
    )
    expect(res.processed).toBe(2) // limited to 2 of the 3 pending
    expect(store.refund_jobs.find((j) => j.id === 'exhausted')!.attempts).toBe(
      5,
    ) // untouched
  })
})
