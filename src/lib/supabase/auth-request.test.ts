import { describe, it, expect } from 'vitest'
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
