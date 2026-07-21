import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseBearer } from './auth-request'

describe('parseBearer', () => {
  it('extracts the token from a well-formed Authorization header', () => {
    expect(parseBearer('Bearer eyJhbGciOi.JhbGc.iOiJ')).toBe('eyJhbGciOi.JhbGc.iOiJ')
  })

  it('is case-insensitive on the scheme and trims whitespace', () => {
    expect(parseBearer('bearer   abc.def.ghi  ')).toBe('abc.def.ghi')
  })

  it('returns null when there is no Authorization header → cookie fallback', () => {
    // The web check-in page sends no Authorization header, so the resolver
    // falls through to the unchanged cookie path.
    expect(parseBearer(null)).toBeNull()
    expect(parseBearer('')).toBeNull()
  })

  it('rejects non-Bearer schemes', () => {
    expect(parseBearer('Basic dXNlcjpwYXNz')).toBeNull()
    expect(parseBearer('Bearer')).toBeNull()
    expect(parseBearer('Bearer   ')).toBeNull()
  })

  it('accepts any Bearer value (not tik_-prefixed) so Supabase JWTs pass', () => {
    // Unlike api-keys.bearerToken, which is tik_-only.
    expect(parseBearer('Bearer sbp_user_jwt_value')).toBe('sbp_user_jwt_value')
  })
})

// ---------------------------------------------------------------------------
// organizerIdForRequest — the resolution the live dashboard uses. It must match
// requireOrganizer() exactly, impersonation included, so a platform admin
// viewing an organizer gets the same "Naživo" behaviour they do.
// ---------------------------------------------------------------------------

const tables: Record<string, unknown> = {}

vi.mock('./server', () => ({
  serviceClient: () => ({
    from: (table: string) => {
      const result = { data: tables[table] ?? null }
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.limit = () => chain
      chain.maybeSingle = () => Promise.resolve(result)
      return chain
    },
  }),
}))

const req = (cookie?: string) =>
  new Request('https://ticketio.sk/api/events/x/sales-stream', {
    headers: cookie ? { cookie } : {},
  })

describe('organizerIdForRequest', () => {
  beforeEach(() => {
    tables.platform_admins = null
    tables.organizers = null
    tables.organizer_members = { organizer_id: 'own-org' }
  })

  it('without an impersonation cookie it resolves the caller’s own organizer', async () => {
    const { organizerIdForRequest } = await import('./auth-request')
    expect(await organizerIdForRequest(req(), 'user-1')).toBe('own-org')
  })

  it('a verified platform admin gets the impersonated organizer', async () => {
    tables.platform_admins = { user_id: 'admin-1' }
    tables.organizers = { id: 'other-org' }
    const { organizerIdForRequest } = await import('./auth-request')
    expect(
      await organizerIdForRequest(
        req('ticketio_impersonate=other-org'),
        'admin-1',
      ),
    ).toBe('other-org')
  })

  it('ignores a forged impersonation cookie from a non-admin', async () => {
    tables.platform_admins = null // not a platform admin
    tables.organizers = { id: 'other-org' }
    const { organizerIdForRequest } = await import('./auth-request')
    // Falls back to their own organizer — never the one in the cookie.
    expect(
      await organizerIdForRequest(
        req('ticketio_impersonate=other-org'),
        'user-1',
      ),
    ).toBe('own-org')
  })

  it('ignores an impersonation cookie pointing at a missing organizer', async () => {
    tables.platform_admins = { user_id: 'admin-1' }
    tables.organizers = null // no such organizer
    const { organizerIdForRequest } = await import('./auth-request')
    expect(
      await organizerIdForRequest(req('ticketio_impersonate=ghost'), 'admin-1'),
    ).toBe('own-org')
  })

  it('returns null when the caller belongs to no organizer at all', async () => {
    tables.organizer_members = null
    const { organizerIdForRequest } = await import('./auth-request')
    expect(await organizerIdForRequest(req(), 'nobody')).toBeNull()
  })
})
