import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prefStore } from '../test/preferences-mock'
import { sha256Hex } from './hash'
import type { OfflineBundlePage } from './types'

vi.mock('@capacitor/preferences', async () => await import('../test/preferences-mock'))
// Only the bundle download talks to the network here; scanning must not.
vi.mock('./api', () => ({
  AuthError: class AuthError extends Error {},
  fetchOfflineBundlePage: vi.fn(),
  checkinScan: vi.fn(() => {
    throw new Error('offline scanning must not call the server')
  }),
}))

const { fetchOfflineBundlePage } = await import('./api')
const { downloadOffline, getOfflineBundle } = await import('./offline')
const { evaluateOffline, scanOffline, NoOfflineDataError } = await import(
  './offline-scan'
)
const { readQueue } = await import('./queue')

const EVENT = '11111111-1111-1111-1111-111111111111'
const TICKET = 'aaaaaaaa-0000-0000-0000-000000000001'
const QR = `TIK.${TICKET}.c2lnbmF0dXJlLWhlcmU`
const OTHER_QR = `TIK.bbbbbbbb-0000-0000-0000-000000000009.b3RoZXI`

function page(overrides: {
  allowReentry?: boolean
  status?: 'valid' | 'used' | 'cancelled'
  usedAt?: string | null
  entryCount?: number
  tokenHash: string
}): OfflineBundlePage {
  return {
    event: {
      id: EVENT,
      title: 'Letný festival',
      startsAt: '2026-07-20T18:00:00.000Z',
      endsAt: '2026-07-20T23:00:00.000Z',
      timezone: 'Europe/Bratislava',
      venueName: 'Amfiteáter',
      allowReentry: overrides.allowReentry ?? false,
    },
    generatedAt: '2026-07-20T15:00:00.000Z',
    total: 1,
    offset: 0,
    limit: 500,
    tickets: [
      {
        id: TICKET,
        tokenHash: overrides.tokenHash,
        holderName: 'Jana Nováková',
        ticketType: 'VIP',
        seat: null,
        status: overrides.status ?? 'valid',
        usedAt: overrides.usedAt ?? null,
        entryCount: overrides.entryCount ?? 0,
      },
    ],
  }
}

async function seed(overrides: Parameters<typeof page>[0] extends never ? never : Omit<Parameters<typeof page>[0], 'tokenHash'>) {
  const tokenHash = await sha256Hex(QR)
  vi.mocked(fetchOfflineBundlePage).mockResolvedValueOnce(
    page({ ...overrides, tokenHash }),
  )
  await downloadOffline(EVENT)
}

describe('evaluateOffline (decision table)', () => {
  const ticket = {
    id: TICKET,
    tokenHash: 'x',
    holderName: 'Jana Nováková',
    ticketType: 'VIP',
    seat: null,
    status: 'valid' as const,
    usedAt: null as string | null,
    entryCount: 0,
  }
  const NOW = '2026-07-20T19:00:00.000Z'

  it('a ticket missing from the bundle is unknown, never invalid', () => {
    const r = evaluateOffline({ ticket: undefined, allowReentry: false, nowIso: NOW })
    expect(r.response.result).toBe('unknown')
    expect(r.response.offline).toBe(true)
    expect(r.patch).toBeNull()
    expect(r.enqueue).toBe(false)
  })

  it('admits a valid ticket, marks it used locally and queues it', () => {
    const r = evaluateOffline({ ticket, allowReentry: false, nowIso: NOW })
    expect(r.response).toMatchObject({ result: 'ok', usedAt: NOW, holderName: 'Jana Nováková' })
    expect(r.patch).toEqual({ status: 'used', usedAt: NOW, entryCount: 1 })
    expect(r.enqueue).toBe(true)
  })

  it('refuses a cancelled ticket without queueing anything', () => {
    const r = evaluateOffline({
      ticket: { ...ticket, status: 'cancelled' },
      allowReentry: false,
      nowIso: NOW,
    })
    expect(r.response.result).toBe('cancelled')
    expect(r.enqueue).toBe(false)
  })

  it('re-entry OFF: an already-used ticket is refused with the first entry time', () => {
    const r = evaluateOffline({
      ticket: { ...ticket, status: 'used', usedAt: '2026-07-20T18:10:00.000Z', entryCount: 1 },
      allowReentry: false,
      nowIso: NOW,
    })
    expect(r.response).toMatchObject({
      result: 'already_used',
      usedAt: '2026-07-20T18:10:00.000Z',
    })
    expect(r.patch).toBeNull()
    expect(r.enqueue).toBe(false)
  })

  it('re-entry ON: admits again, numbers the entry and keeps the ticket used', () => {
    const r = evaluateOffline({
      ticket: { ...ticket, status: 'used', usedAt: '2026-07-20T18:10:00.000Z', entryCount: 1 },
      allowReentry: true,
      nowIso: NOW,
    })
    expect(r.response).toMatchObject({
      result: 'reentry',
      entryCount: 2,
      usedAt: '2026-07-20T18:10:00.000Z', // the PREVIOUS entry
    })
    // status is not in the patch -> stays 'used' -> checked-in total unchanged.
    expect(r.patch).toEqual({ usedAt: NOW, entryCount: 2 })
    expect(r.enqueue).toBe(true)
  })
})

describe('scanOffline (against downloaded data)', () => {
  beforeEach(() => {
    prefStore.clear()
    vi.mocked(fetchOfflineBundlePage).mockReset()
  })

  it('with nothing downloaded it raises NoOfflineDataError', async () => {
    await expect(scanOffline(EVENT, QR)).rejects.toBeInstanceOf(NoOfflineDataError)
  })

  it('admits a scan, persists it locally and queues exactly one entry', async () => {
    await seed({})
    const res = await scanOffline(EVENT, QR, () => '2026-07-20T19:00:00.000Z')
    expect(res).toMatchObject({ result: 'ok', holderName: 'Jana Nováková', offline: true })

    // Local state updated…
    const bundle = await getOfflineBundle(EVENT)
    const stored = Object.values(bundle!.byHash)[0]
    expect(stored.status).toBe('used')
    expect(stored.entryCount).toBe(1)

    // …and queued for sync with the data the server needs.
    const queue = await readQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ eventId: EVENT, ticketId: TICKET, qr: QR })
    expect(queue[0].scannedAt).toBe('2026-07-20T19:00:00.000Z')
    expect(queue[0].deviceLabel).toMatch(/^Ticketio Scan · /)
  })

  it('re-entry OFF: the second scan is refused and adds nothing to the queue', async () => {
    await seed({})
    await scanOffline(EVENT, QR, () => '2026-07-20T19:00:00.000Z')
    const second = await scanOffline(EVENT, QR, () => '2026-07-20T20:00:00.000Z')
    expect(second).toMatchObject({
      result: 'already_used',
      usedAt: '2026-07-20T19:00:00.000Z',
    })
    expect(await readQueue()).toHaveLength(1)
  })

  it('re-entry ON: repeated scans are re-entries, numbered, and each is queued', async () => {
    await seed({ allowReentry: true })
    await scanOffline(EVENT, QR, () => '2026-07-20T19:00:00.000Z')
    const second = await scanOffline(EVENT, QR, () => '2026-07-20T20:00:00.000Z')
    const third = await scanOffline(EVENT, QR, () => '2026-07-20T21:00:00.000Z')

    expect(second).toMatchObject({
      result: 'reentry',
      entryCount: 2,
      usedAt: '2026-07-20T19:00:00.000Z',
    })
    expect(third).toMatchObject({
      result: 'reentry',
      entryCount: 3,
      usedAt: '2026-07-20T20:00:00.000Z',
    })
    // The ticket is still a single admitted person — status never left 'used'.
    const bundle = await getOfflineBundle(EVENT)
    expect(Object.values(bundle!.byHash)[0].status).toBe('used')
    expect(await readQueue()).toHaveLength(3)
  })

  it('a code that is not in the bundle scans as unknown and is not queued', async () => {
    await seed({})
    const res = await scanOffline(EVENT, OTHER_QR)
    expect(res.result).toBe('unknown')
    expect(await readQueue()).toHaveLength(0)
  })

  it('the queue survives an app restart', async () => {
    await seed({})
    await scanOffline(EVENT, QR)
    expect(await readQueue()).toHaveLength(1)

    // Fresh module instances, same persisted storage.
    vi.resetModules()
    const { readQueue: readAfterRestart } = await import('./queue')
    const queue = await readAfterRestart()
    expect(queue).toHaveLength(1)
    expect(queue[0].ticketId).toBe(TICKET)
  })
})
