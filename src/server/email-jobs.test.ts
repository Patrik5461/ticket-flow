import { describe, it, expect } from 'vitest'
import { processEmailJobs } from './email-jobs'
import type { EmailJobsDeps, EmailJobRow } from './email-jobs'

interface Store {
  email_jobs: Record<string, any>[]
}

class Builder {
  private op: 'select' | 'update' = 'select'
  private mutated = false
  private values: Record<string, unknown> = {}
  private eqs: [string, unknown][] = []
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
  sendJob: (job: EmailJobRow) => Promise<void>,
): { deps: EmailJobsDeps; sent: string[] } {
  const sent: string[] = []
  const deps: EmailJobsDeps = {
    db: { from: (t: string) => new Builder(store, t as keyof Store) },
    sendJob: async (j) => {
      await sendJob(j)
      sent.push(j.recipient)
    },
    now: () => '2026-07-16T00:00:00.000Z',
  }
  return { deps, sent }
}

function job(id: string, over: Partial<Record<string, any>> = {}) {
  return {
    id,
    kind: 'bulk',
    recipient: `${id}@x.sk`,
    event_id: null,
    order_id: null,
    subject: 'S',
    html: '<p>H</p>',
    status: 'pending',
    attempts: 0,
    max_attempts: 5,
    ...over,
  }
}

describe('processEmailJobs', () => {
  it('sends each job and marks it sent', async () => {
    const store: Store = { email_jobs: [job('a'), job('b')] }
    const { deps, sent } = makeDeps(store, async () => {})
    const res = await processEmailJobs(deps)
    expect(res).toEqual({ processed: 2, sent: 2, failed: 0 })
    expect(sent.sort()).toEqual(['a@x.sk', 'b@x.sk'])
    expect(store.email_jobs.every((j) => j.status === 'sent')).toBe(true)
    expect(store.email_jobs.every((j) => j.attempts === 1)).toBe(true)
  })

  it('marks a job failed (with error) on send failure, then retries next tick', async () => {
    const store: Store = { email_jobs: [job('a')] }
    let calls = 0
    const { deps } = makeDeps(store, async () => {
      calls++
      if (calls === 1) throw new Error('smtp down')
    })
    const first = await processEmailJobs(deps)
    expect(first).toEqual({ processed: 1, sent: 0, failed: 1 })
    expect(store.email_jobs[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      last_error: 'smtp down',
    })

    const second = await processEmailJobs(deps)
    expect(second).toEqual({ processed: 1, sent: 1, failed: 0 })
    expect(store.email_jobs[0]).toMatchObject({ status: 'sent', attempts: 2 })
  })

  it('skips exhausted jobs and honours the batch limit', async () => {
    const store: Store = {
      email_jobs: [
        job('sent1', { status: 'sent' }),
        job('dead', { status: 'failed', attempts: 5, max_attempts: 5 }),
        job('a'),
        job('b'),
        job('c'),
      ],
    }
    const { deps } = makeDeps(store, async () => {})
    const res = await processEmailJobs(deps, { limit: 2 })
    expect(res.processed).toBe(2)
    expect(store.email_jobs.find((j) => j.id === 'dead')!.attempts).toBe(5)
  })
})
