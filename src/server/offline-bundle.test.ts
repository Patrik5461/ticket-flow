import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { loadOfflineBundle } from './offline-bundle'
import type { OfflineDb } from './offline-bundle'
import { signTicket } from '../lib/qr'

// ---------------------------------------------------------------------------
// Minimal in-memory fake of the query chains this module uses:
//   events:      select().eq().eq().maybeSingle()
//   tickets:     select(count, head).eq()  /  select().eq().order().range()
//   checkin_log: select().in().in()
// ---------------------------------------------------------------------------

interface Store {
  events: Record<string, unknown>[]
  tickets: Record<string, unknown>[]
  checkin_log: Record<string, unknown>[]
}

class Builder {
  private eqs: [string, unknown][] = []
  private ins: [string, unknown[]][] = []
  private orderBy: { col: string; asc: boolean } | null = null
  private countMode = false
  private rangeAt: [number, number] | null = null

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
  in(col: string, arr: unknown[]) {
    this.ins.push([col, arr])
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending ?? true }
    return this
  }
  range(from: number, to: number) {
    this.rangeAt = [from, to]
    return this
  }

  private matched() {
    let rows = this.store[this.table].filter(
      (row) =>
        this.eqs.every(([c, v]) => row[c] === v) &&
        this.ins.every(([c, arr]) => arr.includes(row[c])),
    )
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      rows = [...rows].sort((a, b) => {
        const av = a[col] as string
        const bv = b[col] as string
        const d = av < bv ? -1 : av > bv ? 1 : 0
        return asc ? d : -d
      })
    }
    const all = rows
    if (this.rangeAt) rows = rows.slice(this.rangeAt[0], this.rangeAt[1] + 1)
    return { rows, total: all.length }
  }

  maybeSingle() {
    const { rows } = this.matched()
    return Promise.resolve({ data: rows[0] ?? null, error: null })
  }
  then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
    const { rows, total } = this.matched()
    const payload = this.countMode
      ? { data: null, count: total, error: null }
      : { data: rows, error: null }
    return Promise.resolve(payload).then(resolve, reject)
  }
}

const ORG = 'org-1'
const EVENT_ID = '11111111-1111-1111-1111-111111111111'
const SECRET = 'event-secret-abc'
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001'
const T2 = 'aaaaaaaa-0000-0000-0000-000000000002'

function makeStore(): Store {
  return {
    events: [
      {
        id: EVENT_ID,
        organizer_id: ORG,
        title: 'Letný festival',
        starts_at: '2026-07-20T18:00:00.000Z',
        ends_at: '2026-07-20T23:00:00.000Z',
        timezone: 'Europe/Bratislava',
        venue_name: 'Amfiteáter',
        allow_reentry: true,
        qr_secret: SECRET,
      },
    ],
    tickets: [
      {
        id: T1,
        event_id: EVENT_ID,
        status: 'used',
        used_at: '2026-07-20T18:30:00.000Z',
        holder_name: 'Jana Nováková',
        ticket_types: { name: 'VIP' },
        seats: { sector: 'A', row_label: '3', seat_number: '12' },
      },
      {
        id: T2,
        event_id: EVENT_ID,
        status: 'valid',
        used_at: null,
        holder_name: null,
        ticket_types: { name: 'Štandard' },
        seats: null,
      },
    ],
    checkin_log: [
      { ticket_id: T1, result: 'ok' },
      { ticket_id: T1, result: 'reentry' },
      { ticket_id: T1, result: 'already_used' }, // must NOT count as an entry
      { ticket_id: T2, result: 'invalid' },
    ],
  }
}

const db = (s: Store): OfflineDb => ({
  from: (table: string) => new Builder(s, table as keyof Store),
})

const load = (s: Store, offset = 0, limit = 500, organizerId = ORG) =>
  loadOfflineBundle({
    eventId: EVENT_ID,
    organizerId,
    offset,
    limit,
    now: () => '2026-07-20T15:00:00.000Z',
    db: db(s),
  })

describe('loadOfflineBundle', () => {
  it('ships a SHA-256 of each QR token — and never the qr_secret', async () => {
    const page = (await load(makeStore()))!

    const expected = createHash('sha256')
      .update(signTicket(T1, SECRET))
      .digest('hex')
    expect(page.tickets.find((t) => t.id === T1)!.tokenHash).toBe(expected)

    // The secret (and anything derived from it that could forge a ticket) must
    // not appear anywhere in the payload the device receives.
    const json = JSON.stringify(page)
    expect(json).not.toContain(SECRET)
    expect(json).not.toContain('qr_secret')
    expect(json).not.toContain(signTicket(T1, SECRET))
  })

  it('carries the event metadata the offline scanner needs, incl. allow_reentry', async () => {
    const page = (await load(makeStore()))!
    expect(page.event).toMatchObject({
      id: EVENT_ID,
      title: 'Letný festival',
      endsAt: '2026-07-20T23:00:00.000Z',
      timezone: 'Europe/Bratislava',
      allowReentry: true,
    })
    expect(page.generatedAt).toBe('2026-07-20T15:00:00.000Z')
    expect(page.total).toBe(2)
  })

  it('maps holder, type, seat, status and counts only real admissions', async () => {
    const page = (await load(makeStore()))!
    const first = page.tickets.find((t) => t.id === T1)!
    expect(first).toMatchObject({
      holderName: 'Jana Nováková',
      ticketType: 'VIP',
      seat: 'A · rad 3 · miesto 12',
      status: 'used',
      usedAt: '2026-07-20T18:30:00.000Z',
      entryCount: 2, // 'ok' + 'reentry'; 'already_used' is not an entry
    })
    const second = page.tickets.find((t) => t.id === T2)!
    expect(second).toMatchObject({
      holderName: null,
      seat: null,
      status: 'valid',
      entryCount: 0,
    })
  })

  it('pages: offset/limit slice the list, total stays the full count', async () => {
    const first = (await load(makeStore(), 0, 1))!
    expect(first.tickets.map((t) => t.id)).toEqual([T1])
    expect(first.total).toBe(2)

    const second = (await load(makeStore(), 1, 1))!
    expect(second.tickets.map((t) => t.id)).toEqual([T2])
    expect(second.offset).toBe(1)
  })

  it('returns null for an event the organizer does not own', async () => {
    expect(await load(makeStore(), 0, 500, 'someone-else')).toBeNull()
  })
})
