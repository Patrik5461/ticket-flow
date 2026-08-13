import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyInvoiceQueue } from './health'
import type { InvoiceQueueRow } from './health'
import { MAX_INVOICE_ATTEMPTS } from './settlement-invoicing'

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
    expect(await probe('', mockFetch(200, []))).toEqual({
      status: 'not_configured',
    })
  })

  it('reports ok when the key may list domains', async () => {
    expect(await probe('re_full', mockFetch(200, { data: [] }))).toEqual({
      status: 'ok',
    })
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
      await probe(
        're_bogus',
        mockFetch(401, { statusCode: 401, name: 'validation_error' }),
      ),
    ).toEqual({ status: 'down', detail: 'neplatný kľúč' })
  })

  it('reports degraded on other errors', async () => {
    expect(await probe('re_full', mockFetch(500, {}))).toEqual({
      status: 'degraded',
      detail: 'HTTP 500',
    })
  })
})

/**
 * The invoice queue used to be counted as `invoiced_at is null`, which hid the
 * two states worth seeing: a settlement whose invoicing failed (the worker
 * stamped invoiced_at even on failure, so it looked done) and one issued but
 * never mailed (it has invoiced_at, so it never appeared). The panel therefore
 * read all-clear precisely when a commission was going unbilled.
 */
describe('classifyInvoiceQueue', () => {
  const row = (over: Partial<InvoiceQueueRow> = {}): InvoiceQueueRow => ({
    invoice_status: 'none',
    invoice_sent_at: null,
    invoice_attempts: 0,
    ...over,
  })

  it('counts an untouched settlement as pending, not stuck', () => {
    expect(classifyInvoiceQueue([row()])).toEqual({
      pending: 1,
      failed: 0,
      stuck: 0,
    })
  })

  it('counts a settlement that has already failed a try as stuck', () => {
    const rows = [row({ invoice_status: 'failed', invoice_attempts: 2 })]
    expect(classifyInvoiceQueue(rows)).toEqual({
      pending: 1,
      failed: 0,
      stuck: 1,
    })
  })

  it('reports an exhausted settlement as failed, never as pending', () => {
    const rows = [
      row({
        invoice_status: 'failed',
        invoice_attempts: MAX_INVOICE_ATTEMPTS,
      }),
    ]
    expect(classifyInvoiceQueue(rows)).toEqual({
      pending: 0,
      failed: 1,
      stuck: 0,
    })
  })

  it('still counts an issued-but-unmailed invoice as work', () => {
    const rows = [
      row({
        invoice_status: 'created',
        invoice_sent_at: null,
        invoice_attempts: 1,
      }),
    ]
    expect(classifyInvoiceQueue(rows)).toEqual({
      pending: 1,
      failed: 0,
      stuck: 1,
    })
  })

  it('reports an invoice nobody could be mailed as failed', () => {
    // mailIssuedInvoices() maxes out the attempts when the organizer has no
    // e-mail address, which is the "needs a human" state, not a pending one.
    const rows = [
      row({
        invoice_status: 'created',
        invoice_sent_at: null,
        invoice_attempts: MAX_INVOICE_ATTEMPTS,
      }),
    ]
    expect(classifyInvoiceQueue(rows)).toEqual({
      pending: 0,
      failed: 1,
      stuck: 0,
    })
  })
})
