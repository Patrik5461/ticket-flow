import { describe, it, expect } from 'vitest'
import { handleCheckin } from './checkin-endpoint'
import type { CheckinDeps } from './checkin-endpoint'
import type { CheckinResponse } from './checkin-service'

const OK_RESULT: CheckinResponse = {
  result: 'ok',
  holderName: 'Jana Nováková',
  ticketType: 'Standard',
  usedAt: '2026-07-20T18:00:00.000Z',
  ref: 'a1b2c3d4',
  seat: null,
}

const EVENT_ID = '11111111-1111-4111-8111-111111111111'

function req(body: unknown = { eventId: EVENT_ID, qr: 'TIK.abc.def' }): Request {
  return new Request('http://localhost/api/checkin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Baseline deps: authorized member, successful check-in. Override per test. */
function deps(over: Partial<CheckinDeps> = {}): CheckinDeps {
  return {
    checkRate: () => true,
    resolveUserId: async () => 'user-1',
    organizerIdForUser: async () => 'org-1',
    checkInTicket: async () => OK_RESULT,
    ...over,
  }
}

describe('handleCheckin', () => {
  it('valid token + member → 200 with the scan outcome', async () => {
    // A valid Bearer token resolves to a user id; membership passes.
    const res = await handleCheckin(req(), deps())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ result: 'ok' })
  })

  it('invalid / expired token (no user id) → 401', async () => {
    const res = await handleCheckin(req(), deps({ resolveUserId: async () => null }))
    expect(res.status).toBe(401)
  })

  it('valid token but not a member of any organizer → 403', async () => {
    const res = await handleCheckin(
      req(),
      deps({ organizerIdForUser: async () => null }),
    )
    expect(res.status).toBe(403)
  })

  it('event not owned by the organizer (checkInTicket null) → 403', async () => {
    const res = await handleCheckin(req(), deps({ checkInTicket: async () => null }))
    expect(res.status).toBe(403)
  })

  it('rate limited → 429 before any auth work', async () => {
    let resolved = false
    const res = await handleCheckin(
      req(),
      deps({
        checkRate: () => false,
        resolveUserId: async () => {
          resolved = true
          return 'user-1'
        },
      }),
    )
    expect(res.status).toBe(429)
    expect(resolved).toBe(false)
  })

  it('malformed body → 400 (after auth passes)', async () => {
    const res = await handleCheckin(req({ eventId: 'not-a-uuid' }), deps())
    expect(res.status).toBe(400)
  })

  it('membership is checked for every caller, token or cookie alike', async () => {
    // The same organizerIdForUser gate runs regardless of how the user id was
    // resolved — Bearer is only a transport, not a higher trust level.
    const seen: string[] = []
    const res = await handleCheckin(
      req(),
      deps({
        resolveUserId: async () => 'user-42',
        organizerIdForUser: async (uid) => {
          seen.push(uid)
          return 'org-1'
        },
      }),
    )
    expect(res.status).toBe(200)
    expect(seen).toEqual(['user-42'])
  })
})
