import { describe, it, expect } from 'vitest'
import { joinWaitlist, processWaitlist } from './waitlist'
import type { WaitlistDeps } from './waitlist'

type Row = Record<string, any>
interface Store {
  events: Row[]
  ticket_types: Row[]
  waitlist_entries: Row[]
}

class Builder {
  private op: 'select' | 'update' | 'insert' = 'select'
  private values: Row = {}
  private insertRows: Row[] = []
  private eqs: [string, unknown][] = []
  private lts: [string, unknown][] = []
  private ins: [string, unknown[]][] = []
  private orderCol: string | null = null

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
  lt(c: string, v: unknown) {
    this.lts.push([c, v])
    return this
  }
  in(c: string, v: unknown[]) {
    this.ins.push([c, v])
    return this
  }
  order(c: string) {
    this.orderCol = c
    return this
  }

  private matched() {
    let rows = this.store[this.table].filter(
      (r) =>
        this.eqs.every(([c, v]) => r[c] === v) &&
        this.ins.every(([c, v]) => v.includes(r[c])) &&
        this.lts.every(([c, v]) => r[c] != null && r[c] < (v as any)),
    )
    if (this.orderCol) {
      const c = this.orderCol
      rows = [...rows].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0))
    }
    return rows
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

function makeDeps(
  store: Store,
  sent: { to: string; subject: string }[],
  over: Partial<WaitlistDeps> = {},
): WaitlistDeps {
  return {
    db: { from: (t: string) => new Builder(store, t as keyof Store) },
    sendEmail: async (to, subject) => {
      sent.push({ to, subject })
    },
    buildLink: (slug, id) => `https://x/e/${slug}/checkout?items=${id}:1`,
    now: () => '2026-07-16T12:00:00.000Z',
    nowMs: () => 1_700_000_000_000,
    windowMinutes: 30,
    ...over,
  }
}

describe('joinWaitlist', () => {
  const base = (): Store => ({
    events: [{ id: 'e1', slug: 'fest', status: 'published' }],
    ticket_types: [{ id: 'tt1', event_id: 'e1' }],
    waitlist_entries: [],
  })

  it('adds a waiting entry for a valid signup', async () => {
    const store = base()
    const res = await joinWaitlist(makeDeps(store, []).db, {
      slug: 'fest',
      ticketTypeId: 'tt1',
      email: 'Fan@Example.SK',
    })
    expect(res.ok).toBe(true)
    expect(store.waitlist_entries).toHaveLength(1)
    expect(store.waitlist_entries[0].email).toBe('fan@example.sk')
    expect(store.waitlist_entries[0].status).toBe('waiting')
  })

  it('is a no-op when already waiting', async () => {
    const store = base()
    store.waitlist_entries.push({
      id: 'w1',
      ticket_type_id: 'tt1',
      email: 'fan@example.sk',
      status: 'waiting',
    })
    const res = await joinWaitlist(makeDeps(store, []).db, {
      slug: 'fest',
      ticketTypeId: 'tt1',
      email: 'fan@example.sk',
    })
    expect(res.ok).toBe(true)
    expect(store.waitlist_entries).toHaveLength(1)
  })

  it('rejects an invalid email and unknown event', async () => {
    const store = base()
    expect(
      (
        await joinWaitlist(makeDeps(store, []).db, {
          slug: 'fest',
          ticketTypeId: 'tt1',
          email: 'nope',
        })
      ).ok,
    ).toBe(false)
    expect(
      (
        await joinWaitlist(makeDeps(store, []).db, {
          slug: 'ghost',
          ticketTypeId: 'tt1',
          email: 'a@b.sk',
        })
      ).ok,
    ).toBe(false)
  })
})

function waiting(id: string, over: Row = {}): Row {
  return {
    id,
    event_id: 'e1',
    ticket_type_id: 'tt1',
    email: `${id}@x.sk`,
    status: 'waiting',
    notified_at: null,
    notify_expires_at: null,
    created_at: `2026-07-16T10:00:0${id.slice(-1)}.000Z`,
    ...over,
  }
}

describe('processWaitlist', () => {
  const store = (over: Partial<Store> = {}): Store => ({
    events: [{ id: 'e1', slug: 'fest', title: 'Fest' }],
    ticket_types: [
      { id: 'tt1', event_id: 'e1', name: 'VIP', capacity: 10, sold_count: 8 },
    ],
    waitlist_entries: [],
    ...over,
  })

  it('notifies the first N (=available capacity) in FIFO order and marks them notified', async () => {
    const s = store({
      waitlist_entries: [waiting('w1'), waiting('w2'), waiting('w3')],
    })
    const sent: { to: string; subject: string }[] = []
    const res = await processWaitlist(makeDeps(s, sent))
    // capacity 10 - sold 8 = 2 spots.
    expect(res.notified).toBe(2)
    expect(sent.map((m) => m.to)).toEqual(['w1@x.sk', 'w2@x.sk'])
    const byId = Object.fromEntries(s.waitlist_entries.map((e) => [e.id, e]))
    expect(byId.w1.status).toBe('notified')
    expect(byId.w2.status).toBe('notified')
    expect(byId.w3.status).toBe('waiting')
  })

  it('does not re-notify an already-notified entry on the next run', async () => {
    const s = store({
      waitlist_entries: [
        waiting('w1', {
          status: 'notified',
          notify_expires_at: '2026-07-16T12:30:00.000Z',
        }),
      ],
    })
    const sent: { to: string; subject: string }[] = []
    const res = await processWaitlist(makeDeps(s, sent))
    expect(res.notified).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it('skips types with no free capacity', async () => {
    const s = store({
      ticket_types: [
        { id: 'tt1', event_id: 'e1', name: 'VIP', capacity: 8, sold_count: 8 },
      ],
      waitlist_entries: [waiting('w1')],
    })
    const sent: { to: string; subject: string }[] = []
    const res = await processWaitlist(makeDeps(s, sent))
    expect(res.notified).toBe(0)
    expect(s.waitlist_entries[0].status).toBe('waiting')
  })

  it('requeues an expired notification so it can be offered again', async () => {
    const s = store({
      waitlist_entries: [
        waiting('w1', {
          status: 'notified',
          notify_expires_at: '2026-07-16T11:00:00.000Z', // before now
        }),
      ],
    })
    const sent: { to: string; subject: string }[] = []
    const res = await processWaitlist(makeDeps(s, sent))
    // Requeued to waiting, then re-notified (2 spots free).
    expect(res.notified).toBe(1)
    expect(sent[0].to).toBe('w1@x.sk')
  })

  it('re-queues an entry when its email send fails', async () => {
    const s = store({ waitlist_entries: [waiting('w1')] })
    const sent: { to: string; subject: string }[] = []
    const res = await processWaitlist(
      makeDeps(s, sent, {
        sendEmail: async () => {
          throw new Error('smtp down')
        },
      }),
    )
    expect(res.notified).toBe(0)
    expect(s.waitlist_entries[0].status).toBe('waiting')
  })
})
