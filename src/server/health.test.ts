import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The Resend probe lists domains, which a sending-only key is not allowed to do.
 * Reporting that key as "down" would raise a false alarm in /admin/health while
 * email delivery works fine, so the restricted-key 401 must read as healthy.
 */

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

async function probe(key: string, fetchImpl: typeof fetch) {
  vi.resetModules()
  process.env.RESEND_API_KEY = key
  vi.stubGlobal('fetch', fetchImpl)
  const { checkResend } = await import('./health')
  return checkResend()
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.RESEND_API_KEY
})

describe('checkResend', () => {
  it('reports not_configured without a key', async () => {
    expect(await probe('', mockFetch(200, []))).toEqual({ status: 'not_configured' })
  })

  it('reports ok when the key may list domains', async () => {
    expect(await probe('re_full', mockFetch(200, { data: [] }))).toEqual({ status: 'ok' })
  })

  it('reports ok for a sending-only key (401 restricted_api_key)', async () => {
    const result = await probe(
      're_sending_only',
      mockFetch(401, {
        statusCode: 401,
        message: 'This API key is restricted to only send emails',
        name: 'restricted_api_key',
      }),
    )
    expect(result.status).toBe('ok')
    expect(result.detail).toMatch(/odosielanie/)
  })

  it('reports down for a genuinely invalid key', async () => {
    expect(
      await probe('re_bogus', mockFetch(401, { statusCode: 401, name: 'validation_error' })),
    ).toEqual({ status: 'down', detail: 'neplatný kľúč' })
  })

  it('reports degraded on other errors', async () => {
    expect(await probe('re_full', mockFetch(500, {}))).toEqual({
      status: 'degraded',
      detail: 'HTTP 500',
    })
  })
})
