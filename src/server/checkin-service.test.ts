import { describe, it, expect, beforeEach } from 'vitest'
import { checkInTicket, getCheckinSummary } from './checkin-service'
import type { CheckinDb } from './checkin-service'
import { signTicket } from '../lib/qr'

// ---------------------------------------------------------------------------
// Minimal in-memory fake of the Supabase query builder, covering exactly the
// chains checkin-service uses: select/update/insert + eq/neq + maybeSingle and
// awaiting the builder directly. The single conditional UPDATE (status='valid')
// is modelled faithfully, so idempotency/race behaviour is exercised for real.
// ---------------------------------------------------------------------------

interface Store {
  events: Record<string, unknown>[]
  tickets: Record<string, unknown>[]
  checkin_log: Record<string, unknown>[]
}

class Builder {
  private op: 'select' | 'update' | 'insert' = 'select'
  private mutated = false
  private values: Record<string, unknown> = {}
  private eqs: [string, unknown][] = []
  private neqs: [string, unknown][] = []

  constructor(
    private store: Store,
    private table: keyof Store,
  ) {}

  // A post-mutation .select() means "return representation" — it must not undo an
  // update/insert already staged on this builder.
  select() {
    if (!this.mutated) this.op = 'select'
    return this
  }
  update(values: Record<string, unknown>) {
    this.op = 'update'
    this.mutated = true
    this.values = values
    return this
  }
  insert(values: Record<string, unknown>) {
    this.op = 'insert'
    this.mutated = true
    this.values = values
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

  private run(single: boolean) {
    if (this.op === 'insert') {
      this.store[this.table].push({ ...this.values })
      return { data: null, error: null }
    }
    if (this.op === 'update') {
      const rows = this.matched()
      for (const row of rows) Object.assign(row, this.values)
      return single
        ? { data: rows[0] ?? null, error: null }
        : { data: rows, error: null }
    }
    const rows = this.matched()
    return single
      ? { data: rows[0] ?? null, error: null }
      : { data: rows, error: null }
  }

  maybeSingle() {
    return Promise.resolve(this.run(true))
  }
  // Awaiting the builder directly (non-single terminal, e.g. the summary query).
  then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
    return Promise.resolve(this.run(false)).then(resolve, reject)
  }
}

function fakeDb(store: Store): CheckinDb {
  return { from: (table: string) => new Builder(store, table as keyof Store) }
}

const ORG = 'org-1'
const EVENT_ID = '11111111-1111-1111-1111-111111111111'
const SECRET = 'event-secret-abc'
const USER = 'user-1'
const FIXED_NOW = '2026-07-15T18:00:00.000Z'

function baseStore(): Store {
  return {
    events: [{ id: EVENT_ID, organizer_id: ORG, qr_secret: SECRET }],
    tickets: [
      {
        id: 'aaaaaaaa-0000-0000-0000-000000000001',
        status: 'valid',
        used_at: null,
        holder_name: 'Jana Nováková',
        event_id: EVENT_ID,
        ticket_types: { name: 'VIP' },
      },
    ],
    checkin_log: [],
  }
}

const TICKET_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

describe('checkInTicket', () => {
  let store: Store
  let db: CheckinDb
  beforeEach(() => {
    store = baseStore()
    db = fakeDb(store)
  })

  const scan = (qr: string, now = () => FIXED_NOW) =>
    checkInTicket({
      eventId: EVENT_ID,
      organizerId: ORG,
      qr,
      userId: USER,
      now,
      db,
    })

  it('admits a valid ticket, records holder + type + time, and logs ok', async () => {
    const res = await scan(signTicket(TICKET_ID, SECRET))
    expect(res).toMatchObject({
      result: 'ok',
      holderName: 'Jana Nováková',
      ticketType: 'VIP',
      usedAt: FIXED_NOW,
    })
    // Ticket is now used and stamped with the scanning user.
    expect(store.tickets[0]).toMatchObject({
      status: 'used',
      used_at: FIXED_NOW,
      checked_in_by: USER,
    })
    expect(store.checkin_log.at(-1)).toMatchObject({
      ticket_id: TICKET_ID,
      event_id: EVENT_ID,
      result: 'ok',
    })
  })

  it('is idempotent: a second scan returns already_used with the FIRST time', async () => {
    await scan(signTicket(TICKET_ID, SECRET), () => FIXED_NOW)
    const second = await scan(
      signTicket(TICKET_ID, SECRET),
      () => '2026-07-15T19:30:00.000Z',
    )
    expect(second).toMatchObject({
      result: 'already_used',
      usedAt: FIXED_NOW, // first admission, not the second attempt
      holderName: 'Jana Nováková',
    })
    expect(store.checkin_log.at(-1)).toMatchObject({ result: 'already_used' })
    // used_at was not overwritten by the second scan.
    expect(store.tickets[0].used_at).toBe(FIXED_NOW)
  })

  it('reports cancelled tickets without admitting them', async () => {
    store.tickets[0].status = 'cancelled'
    const res = await scan(signTicket(TICKET_ID, SECRET))
    expect(res?.result).toBe('cancelled')
    expect(store.tickets[0].status).toBe('cancelled')
    expect(store.checkin_log.at(-1)).toMatchObject({ result: 'cancelled' })
  })

  it('rejects a tampered / wrongly-signed code as invalid and logs it with no ticket', async () => {
    const res = await scan(signTicket(TICKET_ID, 'other-secret'))
    expect(res?.result).toBe('invalid')
    expect(res?.holderName).toBeNull()
    // No state change, log row has null ticket_id.
    expect(store.tickets[0].status).toBe('valid')
    expect(store.checkin_log.at(-1)).toMatchObject({
      ticket_id: null,
      result: 'invalid',
    })
  })

  it('treats a validly-signed but unknown ticket id as invalid', async () => {
    const ghost = 'bbbbbbbb-0000-0000-0000-000000000009'
    const res = await scan(signTicket(ghost, SECRET))
    expect(res?.result).toBe('invalid')
    expect(store.checkin_log.at(-1)).toMatchObject({
      ticket_id: null,
      result: 'invalid',
    })
  })

  it('returns null when the event does not belong to the caller organizer', async () => {
    const res = await checkInTicket({
      eventId: EVENT_ID,
      organizerId: 'someone-else',
      qr: signTicket(TICKET_ID, SECRET),
      userId: USER,
      now: () => FIXED_NOW,
      db,
    })
    expect(res).toBeNull()
    // No log written for an unauthorized event.
    expect(store.checkin_log).toHaveLength(0)
  })
})

describe('getCheckinSummary', () => {
  it('counts non-cancelled tickets as total and used ones as checkedIn', async () => {
    const store = baseStore()
    store.tickets.push(
      {
        id: 't2',
        status: 'used',
        used_at: FIXED_NOW,
        holder_name: null,
        event_id: EVENT_ID,
        ticket_types: { name: 'Standard' },
      },
      {
        id: 't3',
        status: 'cancelled',
        used_at: null,
        holder_name: null,
        event_id: EVENT_ID,
        ticket_types: { name: 'Standard' },
      },
    )
    const summary = await getCheckinSummary(EVENT_ID, ORG, fakeDb(store))
    expect(summary).toEqual({ total: 2, checkedIn: 1 }) // cancelled excluded
  })

  it('returns null for an event the organizer does not own', async () => {
    const summary = await getCheckinSummary(
      EVENT_ID,
      'nope',
      fakeDb(baseStore()),
    )
    expect(summary).toBeNull()
  })
})
