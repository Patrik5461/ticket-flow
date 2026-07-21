import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  handleSalesStream,
  resetStreamState,
  activeStreamCount,
  MAX_STREAMS_PER_ORGANIZER,
} from './sales-stream'
import type { StreamDeps } from './sales-stream'
import { loadSalesSnapshot } from './sales-live'
import type { SalesLiveDb, SalesSnapshot } from './sales-live'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'

function snap(over: Partial<SalesSnapshot> = {}): SalesSnapshot {
  return {
    grossCents: 1000,
    feeCents: 40,
    netCents: 960,
    paidOrderCount: 2,
    ticketCount: 3,
    checkedIn: 1,
    at: '2026-07-22T10:00:00.000Z',
    series: {
      hourly: [],
      daily: [],
      eventDay: '2026-07-20',
      timezone: 'Europe/Bratislava',
    },
    ...over,
  }
}

/** Captures the shared poller's tick so tests can drive time by hand. */
function makeDeps(over: Partial<StreamDeps> = {}) {
  const ticks: (() => void)[] = []
  const cleared: unknown[] = []
  const deps: StreamDeps = {
    resolveUserId: () => Promise.resolve('user-1'),
    organizerIdForUser: () => Promise.resolve('org-1'),
    loadSnapshot: () => Promise.resolve(snap()),
    setInterval: (fn) => {
      ticks.push(fn)
      return ticks.length
    },
    clearInterval: (h) => cleared.push(h),
    ...over,
  }
  return { deps, ticks, cleared }
}

const req = () => new Request('https://ticketio.sk/api/events/x/sales-stream')

/**
 * Open a reader and pull chunks until `match` appears. The reader is left OPEN —
 * cancelling it would disconnect the subscriber, which several tests are
 * specifically measuring.
 */
const readers = new WeakMap<
  Response,
  { reader: ReadableStreamDefaultReader<Uint8Array>; text: string }
>()

async function readUntil(
  res: Response,
  match: string,
  maxReads = 20,
): Promise<string> {
  // One reader per response: a stream can only be locked once, and later calls
  // must continue where the previous one stopped.
  let state = readers.get(res)
  if (!state) {
    state = { reader: res.body!.getReader(), text: '' }
    readers.set(res, state)
  }
  const { reader } = state
  const decoder = new TextDecoder()
  let text = state.text
  for (let i = 0; i < maxReads && !text.includes(match); i++) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  state.text = text
  return text
}

/** Wait for the first snapshot frame (connection established). */
const readFirst = (res: Response) => readUntil(res, 'event: snapshot')

describe('handleSalesStream', () => {
  beforeEach(() => resetStreamState())

  it('401 without a session cookie', async () => {
    const { deps } = makeDeps({ resolveUserId: () => Promise.resolve(null) })
    const res = await handleSalesStream(req(), EVENT_ID, deps)
    expect(res.status).toBe(401)
  })

  it('403 when the user belongs to no organizer', async () => {
    const { deps } = makeDeps({
      organizerIdForUser: () => Promise.resolve(null),
    })
    expect((await handleSalesStream(req(), EVENT_ID, deps)).status).toBe(403)
  })

  it("403 for another organizer's event — and nothing is streamed", async () => {
    const loadSnapshot = vi.fn().mockResolvedValue(null)
    const { deps } = makeDeps({ loadSnapshot })
    const res = await handleSalesStream(req(), EVENT_ID, deps)
    expect(res.status).toBe(403)
    expect(res.headers.get('Content-Type')).not.toContain('event-stream')
    expect(activeStreamCount()).toBe(0)
  })

  it('streams the first snapshot immediately, with SSE headers', async () => {
    const { deps } = makeDeps()
    const res = await handleSalesStream(req(), EVENT_ID, deps)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    // Proxy hygiene: nginx must not buffer an SSE response.
    expect(res.headers.get('X-Accel-Buffering')).toBe('no')
    expect(res.headers.get('Cache-Control')).toContain('no-cache')

    const first = await readFirst(res)
    expect(first).toContain('event: snapshot')
    expect(first).toContain('"grossCents":1000')
    expect(first).toContain('"checkedIn":1')
  })

  it('pushes an update only when the numbers actually change', async () => {
    let current = snap()
    const { deps, ticks } = makeDeps({
      loadSnapshot: () => Promise.resolve(current),
    })
    const res = await handleSalesStream(req(), EVENT_ID, deps)

    // Same numbers on the next tick -> nothing is pushed.
    ticks[0]()
    await new Promise((r) => setTimeout(r, 5))

    // A new paid order -> exactly one push.
    current = snap({ grossCents: 2000, paidOrderCount: 3 })
    ticks[0]()

    const text = await readUntil(res, '"grossCents":2000')
    expect(text).toContain('"grossCents":2000')
    // Two snapshot frames total: the initial one and this change — the
    // unchanged tick in between sent nothing.
    expect(text.split('event: snapshot').length - 1).toBe(2)
  })

  it('stops the shared poller when the last viewer disconnects', async () => {
    const controller = new AbortController()
    const { deps, cleared } = makeDeps()
    const request = new Request('https://ticketio.sk/s', {
      signal: controller.signal,
    })

    const res = await handleSalesStream(request, EVENT_ID, deps)
    await readFirst(res)
    expect(activeStreamCount('org-1')).toBe(1)

    // The browser navigates away.
    controller.abort()
    await Promise.resolve()

    expect(activeStreamCount('org-1')).toBe(0)
    // The event's database poller was cleared — no query loop left running.
    expect(cleared.length).toBeGreaterThan(0)
  })

  it('caps concurrent streams per organizer', async () => {
    const { deps } = makeDeps()
    for (let i = 0; i < MAX_STREAMS_PER_ORGANIZER; i++) {
      const res = await handleSalesStream(req(), EVENT_ID, deps)
      await readFirst(res)
    }
    const overflow = await handleSalesStream(req(), EVENT_ID, deps)
    expect(overflow.status).toBe(429)
  })

  it('viewers of one event share a single database poller', async () => {
    const loadSnapshot = vi.fn().mockResolvedValue(snap())
    const { deps, ticks } = makeDeps({ loadSnapshot })

    for (let i = 0; i < 3; i++) {
      const res = await handleSalesStream(req(), EVENT_ID, deps)
      await readFirst(res)
    }
    // Three viewers, one interval.
    expect(ticks).toHaveLength(1)
    expect(activeStreamCount('org-1')).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// End to end over the real snapshot logic: a new paid order must reach an open
// stream on the next tick, with no page refresh involved.
// ---------------------------------------------------------------------------

describe('a new order reaches an open stream', () => {
  const ORG = 'org-1'
  const EVENT = '11111111-1111-4111-8111-111111111111'

  interface Row {
    [k: string]: unknown
  }
  const store: { events: Row[]; orders: Row[]; tickets: Row[] } = {
    events: [],
    orders: [],
    tickets: [],
  }

  class Chain {
    private eqs: [string, unknown][] = []
    private neqs: [string, unknown][] = []
    private countMode = false
    constructor(private table: 'events' | 'orders' | 'tickets') {}
    select(_c?: unknown, o?: { count?: string; head?: boolean }) {
      if (o?.count) this.countMode = true
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
    private rows() {
      return store[this.table].filter(
        (r) =>
          this.eqs.every(([c, v]) => r[c] === v) &&
          this.neqs.every(([c, v]) => r[c] !== v),
      )
    }
    maybeSingle() {
      return Promise.resolve({ data: this.rows()[0] ?? null, error: null })
    }
    then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
      const rows = this.rows()
      return Promise.resolve(
        this.countMode
          ? { data: null, count: rows.length, error: null }
          : { data: rows, error: null },
      ).then(res, rej)
    }
  }

  const fakeDb: SalesLiveDb = { from: (t: string) => new Chain(t as never) }

  beforeEach(() => {
    resetStreamState()
    store.events = [
      {
        id: EVENT,
        organizer_id: ORG,
        starts_at: '2026-07-20T18:00:00.000Z',
        timezone: 'Europe/Bratislava',
      },
    ]
    store.orders = []
    store.tickets = []
  })

  it('pushes the new totals and the updated chart without a refresh', async () => {
    const ticks: (() => void)[] = []
    const deps: StreamDeps = {
      resolveUserId: () => Promise.resolve('user-1'),
      organizerIdForUser: () => Promise.resolve(ORG),
      loadSnapshot: (eventId, organizerId) =>
        loadSalesSnapshot(eventId, organizerId, fakeDb, () =>
          '2026-07-22T10:00:00.000Z',
        ),
      setInterval: (fn) => {
        ticks.push(fn)
        return ticks.length
      },
      clearInterval: () => undefined,
    }

    const res = await handleSalesStream(req(), EVENT, deps)
    const first = await readFirst(res)
    expect(first).toContain('"grossCents":0')

    // Someone buys two tickets while the dashboard is open.
    store.orders.push({
      event_id: EVENT,
      status: 'paid',
      total_cents: 2400,
      fee_cents: 96,
      created_at: '2026-07-20T09:00:00.000Z',
      paid_at: '2026-07-20T09:00:00.000Z',
      order_items: [{ quantity: 2 }],
    })
    store.tickets.push(
      { event_id: EVENT, status: 'valid' },
      { event_id: EVENT, status: 'valid' },
    )
    ticks[0]()

    const text = await readUntil(res, '"grossCents":2400')
    expect(text).toContain('"paidOrderCount":1')
    expect(text).toContain('"ticketCount":2')
    // The chart moved with it: 11:00 local holds the two tickets.
    const frame = text.slice(text.lastIndexOf('data: ') + 6)
    const snapshot = JSON.parse(frame.trim()) as SalesSnapshot
    expect(
      snapshot.series.hourly.find((p) => p.label === '11:00'),
    ).toMatchObject({ tickets: 2, grossCents: 2400 })
  })

  it('pushes a check-in the same way', async () => {
    const ticks: (() => void)[] = []
    store.tickets.push({ event_id: EVENT, status: 'valid' })
    const deps: StreamDeps = {
      resolveUserId: () => Promise.resolve('user-1'),
      organizerIdForUser: () => Promise.resolve(ORG),
      loadSnapshot: (eventId, organizerId) =>
        loadSalesSnapshot(eventId, organizerId, fakeDb),
      setInterval: (fn) => {
        ticks.push(fn)
        return ticks.length
      },
      clearInterval: () => undefined,
    }

    const res = await handleSalesStream(req(), EVENT, deps)
    await readFirst(res)

    store.tickets[0].status = 'used' // scanned at the door
    ticks[0]()

    expect(await readUntil(res, '"checkedIn":1')).toContain('"checkedIn":1')
  })
})
