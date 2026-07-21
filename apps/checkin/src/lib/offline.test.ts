import { describe, it, expect, beforeEach, vi } from 'vitest'
import { prefStore } from '../test/preferences-mock'
import type { OfflineBundlePage } from './types'

vi.mock('@capacitor/preferences', async () => await import('../test/preferences-mock'))
vi.mock('./api', () => ({
  AuthError: class AuthError extends Error {},
  fetchOfflineBundlePage: vi.fn(),
  checkinScan: vi.fn(),
}))

const { fetchOfflineBundlePage } = await import('./api')
const {
  downloadOffline,
  listOffline,
  getOfflineBundle,
  deleteOffline,
  clearAllOffline,
  purgeExpiredOffline,
  RETENTION_MS,
} = await import('./offline')
const { enqueueScan, readQueue } = await import('./queue')

const EVENT = '11111111-1111-1111-1111-111111111111'
const ENDS_AT = '2026-07-20T23:00:00.000Z'

function ticket(n: number) {
  return {
    id: `ticket-${n}`,
    tokenHash: `hash-${n}`,
    holderName: `Hosť ${n}`,
    ticketType: 'VIP',
    seat: null,
    status: 'valid' as const,
    usedAt: null,
    entryCount: 0,
  }
}

function page(
  eventId: string,
  tickets: ReturnType<typeof ticket>[],
  total: number,
  offset: number,
  allowReentry = false,
): OfflineBundlePage {
  return {
    event: {
      id: eventId,
      title: 'Letný festival',
      startsAt: '2026-07-20T18:00:00.000Z',
      endsAt: ENDS_AT,
      timezone: 'Europe/Bratislava',
      venueName: 'Amfiteáter',
      allowReentry,
    },
    generatedAt: '2026-07-20T15:00:00.000Z',
    total,
    offset,
    limit: 2,
    tickets,
  }
}

describe('downloadOffline', () => {
  beforeEach(() => {
    prefStore.clear()
    vi.mocked(fetchOfflineBundlePage).mockReset()
  })

  it('walks every page, reports progress and stores the whole list', async () => {
    vi.mocked(fetchOfflineBundlePage)
      .mockResolvedValueOnce(page(EVENT, [ticket(1), ticket(2)], 3, 0, true))
      .mockResolvedValueOnce(page(EVENT, [ticket(3)], 3, 2, true))

    const progress: number[] = []
    const meta = await downloadOffline(EVENT, (p) => progress.push(p))

    expect(fetchOfflineBundlePage).toHaveBeenCalledTimes(2)
    expect(meta.ticketCount).toBe(3)
    expect(meta.allowReentry).toBe(true)
    expect(meta.syncedAt).toBe('2026-07-20T15:00:00.000Z')
    expect(progress[progress.length - 1]).toBe(1)

    const bundle = await getOfflineBundle(EVENT)
    expect(Object.keys(bundle!.byHash).sort()).toEqual(['hash-1', 'hash-2', 'hash-3'])
  })

  it('never stores a qr_secret — only digests', async () => {
    vi.mocked(fetchOfflineBundlePage).mockResolvedValueOnce(
      page(EVENT, [ticket(1)], 1, 0),
    )
    await downloadOffline(EVENT)
    const dump = JSON.stringify([...prefStore.entries()])
    expect(dump).not.toMatch(/qr_secret|secret/i)
    expect(dump).toContain('hash-1')
  })

  it('a failing page leaves the previous bundle untouched', async () => {
    vi.mocked(fetchOfflineBundlePage).mockResolvedValueOnce(
      page(EVENT, [ticket(1)], 1, 0),
    )
    await downloadOffline(EVENT)

    vi.mocked(fetchOfflineBundlePage).mockRejectedValueOnce(new Error('offline'))
    await expect(downloadOffline(EVENT)).rejects.toThrow()

    const bundle = await getOfflineBundle(EVENT)
    expect(Object.keys(bundle!.byHash)).toEqual(['hash-1'])
  })
})

describe('retention', () => {
  beforeEach(async () => {
    prefStore.clear()
    vi.mocked(fetchOfflineBundlePage).mockReset()
    vi.mocked(fetchOfflineBundlePage).mockResolvedValue(
      page(EVENT, [ticket(1)], 1, 0),
    )
    await downloadOffline(EVENT)
  })

  it('keeps data while the event is recent', async () => {
    const justBefore = Date.parse(ENDS_AT) + RETENTION_MS - 1000
    expect(await purgeExpiredOffline(justBefore)).toEqual([])
    expect(Object.keys(await listOffline())).toEqual([EVENT])
  })

  it('drops data 24 h after the event ended', async () => {
    const after = Date.parse(ENDS_AT) + RETENTION_MS + 1000
    expect(await purgeExpiredOffline(after)).toEqual([EVENT])
    expect(await listOffline()).toEqual({})
    expect(await getOfflineBundle(EVENT)).toBeNull()
  })

  it('deleteOffline removes the event and its tickets', async () => {
    await deleteOffline(EVENT)
    expect(await listOffline()).toEqual({})
    expect(
      [...prefStore.keys()].some((k) => k.startsWith('offline.tickets.')),
    ).toBe(false)
  })

  it('warns about multiple devices once per event, not on every refresh', async () => {
    const { shouldWarnMultiDevice } = await import('./offline')
    expect(await shouldWarnMultiDevice(EVENT)).toBe(true) // first download
    expect(await shouldWarnMultiDevice(EVENT)).toBe(false) // a later "Aktualizovať"
    // A different event warns on its own first download.
    expect(await shouldWarnMultiDevice('other-event')).toBe(true)
  })

  it('signing out wipes tickets, queue and conflict reports', async () => {
    await enqueueScan({
      id: 'local-1',
      eventId: EVENT,
      ticketId: 'ticket-1',
      ref: 'REF1',
      holderName: 'Hosť 1',
      qr: 'TIK.ticket-1.sig',
      scannedAt: '2026-07-20T19:00:00.000Z',
      deviceLabel: 'Ticketio Scan · TEST01',
    })

    await clearAllOffline()

    expect(await listOffline()).toEqual({})
    expect(await readQueue()).toHaveLength(0)
    // Nothing describing tickets or holders is left behind.
    // Includes the multi-device warning flags — nothing offline.* survives.
    const leftovers = [...prefStore.keys()].filter((k) =>
      k.startsWith('offline.'),
    )
    expect(leftovers).toEqual([])
  })
})
