/**
 * The guard on /api/cron/*. The behaviour that matters: a wrong secret is
 * rejected, an unset secret rejects everything rather than opening the workers,
 * and the comparison does not return early on the first differing byte.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const env = vi.hoisted(() => ({ CRON_SECRET: '' }))
vi.mock('../lib/env', () => ({ getEnv: () => env }))

const { cronUnauthorized } = await import('./cron-auth')

function req(header?: string): Request {
  return new Request('https://ticketio.sk/api/cron/process-email', {
    method: 'POST',
    headers: header === undefined ? {} : { 'x-cron-secret': header },
  })
}

describe('cronUnauthorized', () => {
  beforeEach(() => {
    env.CRON_SECRET = 'a'.repeat(32)
  })

  it('lets the matching secret through', () => {
    expect(cronUnauthorized(req('a'.repeat(32)))).toBeNull()
  })

  it('rejects a wrong secret of the same length', async () => {
    const res = cronUnauthorized(req('b'.repeat(32)))
    expect(res?.status).toBe(401)
    await expect(res?.text()).resolves.toBe('Unauthorized')
  })

  it('rejects a secret that only shares a prefix', () => {
    expect(cronUnauthorized(req('a'.repeat(31) + 'b'))?.status).toBe(401)
  })

  it('rejects a missing header', () => {
    expect(cronUnauthorized(req())?.status).toBe(401)
  })

  it('rejects a shorter and a longer secret without throwing', () => {
    // timingSafeEqual raises on length mismatch, so the length check has to come
    // first — otherwise these two turn a 401 into a 500.
    expect(cronUnauthorized(req('a'.repeat(31)))?.status).toBe(401)
    expect(cronUnauthorized(req('a'.repeat(33)))?.status).toBe(401)
  })

  it('rejects everything when CRON_SECRET is unset', () => {
    env.CRON_SECRET = ''
    expect(cronUnauthorized(req(''))?.status).toBe(401)
    expect(cronUnauthorized(req())?.status).toBe(401)
    expect(cronUnauthorized(req('anything'))?.status).toBe(401)
  })
})
