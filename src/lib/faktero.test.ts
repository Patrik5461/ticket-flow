import { describe, it, expect, vi, afterEach } from 'vitest'
import { FakteroClient } from './faktero'
import type { InvoiceRequest } from './faktero'

interface Call {
  url: string
  body: any
  auth: string | null
}

/** Stub fetch, answering each POST from `answers` in order. */
function stubFetch(answers: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (url: string, init: any) => {
    calls.push({
      url,
      body: init.body ? JSON.parse(init.body) : null,
      auth: init.headers.Authorization ?? null,
    })
    const a = answers[calls.length - 1] ?? { body: {} }
    return {
      ok: (a.status ?? 200) < 400,
      status: a.status ?? 200,
      text: async () =>
        typeof a.body === 'string' ? a.body : JSON.stringify(a.body),
    } as any
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

afterEach(() => vi.unstubAllGlobals())

const NOW = () => new Date('2026-09-01T22:30:00Z') // 2026-09-02 v Bratislave

function request(over: Partial<InvoiceRequest> = {}): InvoiceRequest {
  return {
    customer: {
      name: 'Firma A s.r.o.',
      ico: '12345678',
      dic: '2020202020',
      icDph: null,
      email: 'fakturacia@firma.sk',
      address: 'Hlavná 1, 058 01 Poprad',
      externalId: 'org-1',
      providerId: null,
      ...(over.customer ?? {}),
    },
    periodLabel: 'august 2026',
    amountCents: 1005,
    description: 'Provízia platformy Ticketio — august 2026',
    externalId: 'settlement-1',
    ...over,
  }
}

describe('FakteroClient', () => {
  it('creates the customer first, then the invoice billed to its id', async () => {
    const calls = stubFetch([
      { body: { data: { id: 'cust-1' } } },
      { body: { data: { id: 'inv-1', invoice_number: '20260901' } } },
    ])
    const client = new FakteroClient(
      'fk_test_x',
      'https://faktero.sk/api/v1',
      NOW,
    )

    const res = await client.createInvoice(request())

    expect(calls.map((c) => c.url)).toEqual([
      'https://faktero.sk/api/v1/customers',
      'https://faktero.sk/api/v1/invoices',
    ])
    expect(calls[0].auth).toBe('Bearer fk_test_x')
    expect(calls[0].body).toMatchObject({
      name: 'Firma A s.r.o.',
      ico: '12345678',
      dic: '2020202020',
      ic_dph: null,
      email: 'fakturacia@firma.sk',
      street: 'Hlavná 1, 058 01 Poprad',
      country: 'SK',
      external_id: 'org-1',
    })
    expect(calls[1].body.customer_id).toBe('cust-1')
    // The id is the handle later calls need; the number is for people.
    expect(res).toEqual({
      id: 'inv-1',
      number: '20260901',
      customerId: 'cust-1',
    })
  })

  it('skips the customer call when the id is already known', async () => {
    const calls = stubFetch([{ body: { data: { id: 'inv-2' } } }])
    const client = new FakteroClient(
      'fk_test_x',
      'https://faktero.sk/api/v1',
      NOW,
    )

    const res = await client.createInvoice(
      request({ customer: { providerId: 'cust-9' } as any }),
    )

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/invoices')
    expect(res.customerId).toBe('cust-9')
  })

  it('sends the line item the way the API expects it', async () => {
    const calls = stubFetch([
      { body: { data: { id: 'cust-1' } } },
      { body: { data: { id: 'inv-1' } } },
    ])
    const client = new FakteroClient(
      'fk_test_x',
      'https://faktero.sk/api/v1',
      NOW,
    )

    await client.createInvoice(request())

    const body = calls[1].body
    expect(body.items).toEqual([
      {
        name: 'Provízia platformy Ticketio — august 2026',
        quantity: 1,
        unit: 'ks',
        unit_price: 10.05, // cents, not floats: 1005 -> 10.05
        vat_rate: 0, // Ticketio is not a VAT payer
      },
    ])
    expect(body.currency).toBe('EUR')
    expect(body.external_id).toBe('settlement-1')
    // Issue date is read in Bratislava, so 22:30 UTC is already the next day.
    expect(body.issue_date).toBe('2026-09-02')
    expect(body.due_date).toBe('2026-09-09') // +7 days
  })

  it('crosses a month boundary when adding the payment term', async () => {
    const calls = stubFetch([
      { body: { data: { id: 'c' } } },
      { body: { data: { id: 'i' } } },
    ])
    const client = new FakteroClient(
      'fk_test_x',
      'https://faktero.sk/api/v1',
      () => new Date('2026-09-28T08:00:00Z'),
    )

    await client.createInvoice(request())

    expect(calls[1].body.issue_date).toBe('2026-09-28')
    expect(calls[1].body.due_date).toBe('2026-10-05')
  })

  it('throws with the API error body when a call fails', async () => {
    stubFetch([
      {
        status: 422,
        body: {
          error: { code: 'validation_error', message: 'ico je povinné' },
        },
      },
    ])
    const client = new FakteroClient(
      'fk_test_x',
      'https://faktero.sk/api/v1',
      NOW,
    )

    await expect(client.createInvoice(request())).rejects.toThrow(
      /422.*validation_error/s,
    )
  })

  it('throws rather than reporting success when the response carries no id', async () => {
    stubFetch([
      { body: { data: { id: 'cust-1' } } },
      { body: { data: { status: 'draft' } } },
    ])
    const client = new FakteroClient(
      'fk_test_x',
      'https://faktero.sk/api/v1',
      NOW,
    )

    await expect(client.createInvoice(request())).rejects.toThrow(/chýba id/)
  })

  it('finds an earlier invoice by external_id, matching client-side', async () => {
    const calls = stubFetch([
      {
        body: {
          data: [
            { id: 'a', external_id: 'iny', invoice_number: '1' },
            {
              id: 'b',
              external_id: 'settlement-1',
              invoice_number: '20260901',
              customer_id: 'cust-1',
            },
          ],
        },
      },
    ])
    const client = new FakteroClient(
      'fk_test_x',
      'https://faktero.sk/api/v1',
      NOW,
    )

    const hit = await client.findByExternalId('settlement-1')

    // The list endpoint ignores ?external_id=, so it is asked for everything.
    expect(calls[0].url).toBe('https://faktero.sk/api/v1/invoices')
    expect(hit).toEqual({
      id: 'b',
      number: '20260901',
      customerId: 'cust-1',
      sentAt: null, // never mailed, so the mailing pass still has to
    })
  })

  it('answers null when no invoice carries the external_id', async () => {
    stubFetch([{ body: { data: [{ id: 'a', external_id: 'iny' }] } }])
    const client = new FakteroClient(
      'fk_test_x',
      'https://faktero.sk/api/v1',
      NOW,
    )

    expect(await client.findByExternalId('settlement-1')).toBeNull()
  })

  it('tolerates a trailing slash in the configured base URL', async () => {
    const calls = stubFetch([
      { body: { data: { id: 'c' } } },
      { body: { data: { id: 'i' } } },
    ])
    const client = new FakteroClient(
      'fk_test_x',
      'https://faktero.sk/api/v1/',
      NOW,
    )

    await client.createInvoice(request())

    expect(calls[0].url).toBe('https://faktero.sk/api/v1/customers')
  })
})
