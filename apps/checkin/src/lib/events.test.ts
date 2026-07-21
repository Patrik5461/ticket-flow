import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { prefStore } from '../test/preferences-mock'
import type { OfflineBundlePage } from './types'

vi.mock('@capacitor/preferences', async () => await import('../test/preferences-mock'))
vi.mock('./api', () => ({
  AuthError: class AuthError extends Error {},
  fetchOfflineBundlePage: vi.fn(),
  checkinScan: vi.fn(),
}))

// Chainable Supabase stub covering the two chains events.ts uses:
//   from('events').select().order()                      -> awaited
//   from('tickets').select(count,head).eq().in()         -> awaited
let eventsReply: () => Promise<unknown>
let countReply: () => Promise<unknown>

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = () => eventsReply()
      chain.in = () => countReply()
      return table === 'events' ? chain : chain
    },
  },
  accessToken: vi.fn(),
}))

const { fetchOfflineBundlePage } = await import('./api')
const { downloadOffline } = await import('./offline')
const { scanOffline } = await import('./offline-scan')
const { loadEvents, loadOfflineEvents } = await import('./events')
const { sha256Hex } = await import('./hash')

const EVENT = '11111111-1111-1111-1111-111111111111'
const QR1 = 'TIK.ticket-1.sig'
const QR2 = 'TIK.ticket-2.sig'

function ticket(n: number, tokenHash: string, status: 'valid' | 'cancelled' = 'valid') {
  return {
    id: `ticket-${n}`,
    tokenHash,
    holderName: `Hosť ${n}`,
    ticketType: 'VIP',
    seat: null,
    status,
    usedAt: null,
    entryCount: 0,
  }
}

async function seedBundle(): Promise<void> {
  const [h1, h2] = await Promise.all([sha256Hex(QR1), sha256Hex(QR2)])
  const pageData: OfflineBundlePage = {
    event: {
      id: EVENT,
      title: 'Letný festival',
      startsAt: '2026-07-20T18:00:00.000Z',
      endsAt: '2026-07-20T23:00:00.000Z',
      timezone: 'Europe/Bratislava',
      venueName: 'Amfiteáter',
      allowReentry: false,
    },
    generatedAt: '2026-07-20T15:00:00.000Z',
    total: 3,
    offset: 0,
    limit: 500,
    tickets: [
      ticket(1, h1),
      ticket(2, h2),
      ticket(3, 'hash-cancelled', 'cancelled'),
    ],
  }
  vi.mocked(fetchOfflineBundlePage).mockResolvedValueOnce(pageData)
  await downloadOffline(EVENT)
}

const setOnline = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', {
    value,
    configurable: true,
    writable: true,
  })
}

describe('loadEvents', () => {
  beforeEach(() => {
    prefStore.clear()
    vi.mocked(fetchOfflineBundlePage).mockReset()
    eventsReply = () =>
      Promise.resolve({
        data: [
          {
            id: EVENT,
            title: 'Letný festival',
            starts_at: '2026-07-20T18:00:00.000Z',
            timezone: 'Europe/Bratislava',
            venue_name: 'Amfiteáter',
          },
        ],
        error: null,
      })
    countReply = () => Promise.resolve({ count: 7 })
    setOnline(true)
  })

  afterEach(() => setOnline(true))

  it('uses server data when the network answers', async () => {
    const { events, source } = await loadEvents()
    expect(source).toBe('server')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ title: 'Letný festival', total: 7 })
  })

  it('falls back to downloaded data instead of hanging forever', async () => {
    await seedBundle()
    // Airplane mode: the request never settles (the bug — a permanent spinner).
    eventsReply = () => new Promise(() => {})

    const { events, source } = await loadEvents(20)

    expect(source).toBe('offline')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ id: EVENT, title: 'Letný festival', offline: true })
  })

  it('goes straight to local data when the device knows it is offline', async () => {
    await seedBundle()
    setOnline(false)
    let called = false
    eventsReply = () => {
      called = true
      return Promise.resolve({ data: [], error: null })
    }

    const { source } = await loadEvents()
    expect(source).toBe('offline')
    expect(called).toBe(false)
  })

  it('falls back when Supabase returns an error too', async () => {
    await seedBundle()
    eventsReply = () => Promise.resolve({ data: null, error: { message: 'nope' } })
    const { source, events } = await loadEvents(50)
    expect(source).toBe('offline')
    expect(events).toHaveLength(1)
  })

  it('offline with nothing downloaded resolves to an empty list, not an error', async () => {
    setOnline(false)
    const { events, source } = await loadEvents()
    expect(source).toBe('offline')
    expect(events).toEqual([])
  })
})

describe('loadOfflineEvents counters', () => {
  beforeEach(async () => {
    prefStore.clear()
    vi.mocked(fetchOfflineBundlePage).mockReset()
    await seedBundle()
  })

  it('counts local tickets, excluding cancelled ones', async () => {
    const [row] = await loadOfflineEvents()
    expect(row).toMatchObject({ total: 2, checkedIn: 0, syncedAt: '2026-07-20T15:00:00.000Z' })
  })

  it('reflects admissions made offline, so the door sees its progress', async () => {
    setOnline(false)
    await scanOffline(EVENT, QR1, 'scan-1')
    const [row] = await loadOfflineEvents()
    expect(row).toMatchObject({ total: 2, checkedIn: 1 })

    await scanOffline(EVENT, QR2, 'scan-2')
    const [after] = await loadOfflineEvents()
    expect(after.checkedIn).toBe(2)
  })

  it('list -> scanner -> list works entirely offline', async () => {
    setOnline(false)
    // 1. list from local data
    const first = await loadEvents()
    expect(first.source).toBe('offline')
    // 2. scan in the scanner
    const scan = await scanOffline(EVENT, QR1, 'scan-1')
    expect(scan.result).toBe('ok')
    // 3. back to the list — resolves, and shows the scan
    const second = await loadEvents()
    expect(second.source).toBe('offline')
    expect(second.events[0].checkedIn).toBe(1)
  })
})
