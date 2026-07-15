import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const SUPA_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TICKETIO_SUPABASE_URL',
  'TICKETIO_SUPABASE_ANON_KEY',
  'TICKETIO_SUPABASE_SERVICE_ROLE_KEY',
]

function clear() {
  for (const k of SUPA_KEYS) delete process.env[k]
}

describe('env Supabase aliases', () => {
  beforeEach(() => {
    clear()
    vi.resetModules()
  })
  afterEach(clear)

  it('falls back to the TICKETIO_ alias when the plain name is unset', async () => {
    process.env.TICKETIO_SUPABASE_URL = 'https://alias.supabase.co'
    process.env.TICKETIO_SUPABASE_ANON_KEY = 'alias-anon'
    const { getEnv } = await import('./env')
    const env = getEnv()
    expect(env.SUPABASE_URL).toBe('https://alias.supabase.co')
    expect(env.SUPABASE_ANON_KEY).toBe('alias-anon')
  })

  it('prefers the plain SUPABASE_ name over the TICKETIO_ alias', async () => {
    process.env.SUPABASE_URL = 'https://plain.supabase.co'
    process.env.TICKETIO_SUPABASE_URL = 'https://alias.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'plain-anon'
    const { getEnv } = await import('./env')
    expect(getEnv().SUPABASE_URL).toBe('https://plain.supabase.co')
  })

  it('parses without a service role key, but getServiceRoleKey throws lazily', async () => {
    process.env.SUPABASE_URL = 'https://plain.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'plain-anon'
    const { getEnv, getServiceRoleKey } = await import('./env')
    expect(getEnv().SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(() => getServiceRoleKey()).toThrow(/service role/i)
  })

  it('resolves the service role key from the TICKETIO_ alias', async () => {
    process.env.SUPABASE_URL = 'https://plain.supabase.co'
    process.env.SUPABASE_ANON_KEY = 'plain-anon'
    process.env.TICKETIO_SUPABASE_SERVICE_ROLE_KEY = 'alias-service'
    const { getServiceRoleKey } = await import('./env')
    expect(getServiceRoleKey()).toBe('alias-service')
  })
})
