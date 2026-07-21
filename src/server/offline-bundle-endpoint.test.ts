import { describe, it, expect, vi } from 'vitest'
import { handleOfflineBundle } from './offline-bundle-endpoint'
import type { OfflineBundleDeps } from './offline-bundle-endpoint'
import type { OfflineBundlePage } from './offline-bundle'

const EVENT_ID = '11111111-1111-4111-8111-111111111111'

const page: OfflineBundlePage = {
  event: {
    id: EVENT_ID,
    title: 'Letný festival',
    startsAt: '2026-07-20T18:00:00.000Z',
    endsAt: null,
    timezone: 'Europe/Bratislava',
    venueName: null,
    allowReentry: false,
  },
  generatedAt: '2026-07-20T15:00:00.000Z',
  total: 1,
  offset: 0,
  limit: 500,
  tickets: [
    {
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      tokenHash: 'abc123',
      holderName: 'Jana Nováková',
      ticketType: 'VIP',
      seat: null,
      status: 'valid',
      usedAt: null,
      entryCount: 0,
    },
  ],
}

function deps(over: Partial<OfflineBundleDeps> = {}): OfflineBundleDeps {
  return {
    checkRate: () => true,
    resolveUserId: () => Promise.resolve('user-1'),
    organizerIdForUser: () => Promise.resolve('org-1'),
    loadBundle: () => Promise.resolve(page),
    ...over,
  }
}

const req = (query = `?eventId=${EVENT_ID}`) =>
  new Request(`https://ticketio.sk/api/offline-bundle${query}`, {
    headers: { authorization: 'Bearer token' },
  })

describe('handleOfflineBundle', () => {
  it('returns the bundle for an authorized member', async () => {
    const res = await handleOfflineBundle(req(), deps())
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    await expect(res.json()).resolves.toMatchObject({ total: 1 })
  })

  it('rate limits before doing anything else', async () => {
    const resolveUserId = vi.fn()
    const res = await handleOfflineBundle(
      req(),
      deps({ checkRate: () => false, resolveUserId }),
    )
    expect(res.status).toBe(429)
    expect(resolveUserId).not.toHaveBeenCalled()
  })

  it('401 without a valid token or cookie', async () => {
    const res = await handleOfflineBundle(
      req(),
      deps({ resolveUserId: () => Promise.resolve(null) }),
    )
    expect(res.status).toBe(401)
  })

  it('403 for an authenticated user who is not an organizer member', async () => {
    const loadBundle = vi.fn()
    const res = await handleOfflineBundle(
      req(),
      deps({ organizerIdForUser: () => Promise.resolve(null), loadBundle }),
    )
    expect(res.status).toBe(403)
    // Never even reaches the data — no ticket list leaks to a non-member.
    expect(loadBundle).not.toHaveBeenCalled()
  })

  it('403 when the event belongs to a different organizer', async () => {
    const res = await handleOfflineBundle(
      req(),
      deps({ loadBundle: () => Promise.resolve(null) }),
    )
    expect(res.status).toBe(403)
  })

  it('400 for a missing or malformed eventId', async () => {
    expect((await handleOfflineBundle(req(''), deps())).status).toBe(400)
    expect(
      (await handleOfflineBundle(req('?eventId=not-a-uuid'), deps())).status,
    ).toBe(400)
  })

  it('passes paging through, with defaults, and rejects an oversized limit', async () => {
    const loadBundle = vi.fn().mockResolvedValue(page)

    await handleOfflineBundle(req(), deps({ loadBundle }))
    expect(loadBundle).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      organizerId: 'org-1',
      offset: 0,
      limit: 500,
    })

    await handleOfflineBundle(
      req(`?eventId=${EVENT_ID}&offset=500&limit=250`),
      deps({ loadBundle }),
    )
    expect(loadBundle).toHaveBeenLastCalledWith({
      eventId: EVENT_ID,
      organizerId: 'org-1',
      offset: 500,
      limit: 250,
    })

    const tooBig = await handleOfflineBundle(
      req(`?eventId=${EVENT_ID}&limit=5000`),
      deps(),
    )
    expect(tooBig.status).toBe(400)
  })

  it('checks membership for every caller, cookie or Bearer alike', async () => {
    const organizerIdForUser = vi.fn().mockResolvedValue('org-1')
    const cookieReq = new Request(
      `https://ticketio.sk/api/offline-bundle?eventId=${EVENT_ID}`,
    )
    await handleOfflineBundle(cookieReq, deps({ organizerIdForUser }))
    await handleOfflineBundle(req(), deps({ organizerIdForUser }))
    expect(organizerIdForUser).toHaveBeenCalledTimes(2)
  })
})
