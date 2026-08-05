import { describe, it, expect } from 'vitest'
import {
  issueSettlementInvoices,
  MAX_INVOICE_ATTEMPTS,
} from './settlement-invoicing'
import type { InvoicingDeps } from './settlement-invoicing'
import type { InvoiceRequest } from '../lib/faktero'

interface Store {
  settlements: Record<string, any>[]
  organizers: Record<string, any>[]
}

class Builder {
  private op: 'select' | 'update' = 'select'
  private mutated = false
  private values: Record<string, unknown> = {}
  private eqs: [string, unknown][] = []
  private gts: [string, number][] = []
  private lts: [string, number][] = []
  private ins: [string, unknown[]][] = []
  private iss: [string, null][] = []
  private lim: number | null = null

  constructor(
    private store: Store,
    private table: keyof Store,
  ) {}

  select() {
    if (!this.mutated) this.op = 'select'
    return this
  }
  update(v: Record<string, unknown>) {
    this.op = 'update'
    this.mutated = true
    this.values = v
    return this
  }
  eq(c: string, v: unknown) {
    this.eqs.push([c, v])
    return this
  }
  gt(c: string, v: number) {
    this.gts.push([c, v])
    return this
  }
  lt(c: string, v: number) {
    this.lts.push([c, v])
    return this
  }
  in(c: string, v: unknown[]) {
    this.ins.push([c, v])
    return this
  }
  is(c: string, v: null) {
    this.iss.push([c, v])
    return this
  }
  limit(n: number) {
    this.lim = n
    return this
  }
  private matched() {
    let rows = this.store[this.table].filter(
      (r) =>
        this.eqs.every(([c, v]) => r[c] === v) &&
        this.gts.every(([c, v]) => r[c] > v) &&
        this.lts.every(([c, v]) => (r[c] ?? 0) < v) &&
        this.ins.every(([c, v]) => v.includes(r[c])) &&
        this.iss.every(([c]) => (r[c] ?? null) === null),
    )
    if (this.lim != null) rows = rows.slice(0, this.lim)
    return rows
  }
  private run(single: boolean) {
    if (this.op === 'update') {
      const rows = this.matched()
      for (const r of rows) Object.assign(r, this.values)
      return { data: rows, error: null }
    }
    const rows = this.matched().map((r) => ({ ...r }))
    return single
      ? { data: rows[0] ?? null, error: null }
      : { data: rows, error: null }
  }
  maybeSingle() {
    return Promise.resolve(this.run(true))
  }
  then(res: (v: unknown) => void, rej?: (e: unknown) => void) {
    return Promise.resolve(this.run(false)).then(res, rej)
  }
}

function makeDeps(
  store: Store,
  createInvoice: (
    req: InvoiceRequest,
  ) => Promise<{ id: string; customerId?: string }>,
): { deps: InvoicingDeps; invoiced: InvoiceRequest[] } {
  const invoiced: InvoiceRequest[] = []
  const deps: InvoicingDeps = {
    db: { from: (t: string) => new Builder(store, t as keyof Store) },
    createInvoice: async (req) => {
      invoiced.push(req)
      return createInvoice(req)
    },
    periodLabel: () => 'jún 2026',
    now: () => '2026-07-16T00:00:00.000Z',
  }
  return { deps, invoiced }
}

function baseStore(): Store {
  return {
    organizers: [
      {
        id: 'org1',
        name: 'Firma A',
        ico: '111',
        dic: null,
        ic_dph: null,
        email: 'a@x.sk',
        address: 'Hlavná 1, Poprad',
        faktero_customer_id: null,
      },
      {
        id: 'org2',
        name: 'Firma B',
        ico: '222',
        dic: null,
        ic_dph: null,
        email: 'b@x.sk',
        address: null,
        faktero_customer_id: 'cust-b',
      },
    ],
    settlements: [
      {
        id: 's1',
        organizer_id: 'org1',
        period_month: '2026-06-01',
        fee_cents: 500,
        invoice_status: 'none',
        invoice_attempts: 0,
      },
      {
        id: 's2',
        organizer_id: 'org2',
        period_month: '2026-06-01',
        fee_cents: 800,
        invoice_status: 'none',
        invoice_attempts: 0,
      },
      {
        id: 's3',
        organizer_id: 'org1',
        period_month: '2026-06-01',
        fee_cents: 0,
        invoice_status: 'none',
        invoice_attempts: 0,
      }, // no fee
      {
        id: 's4',
        organizer_id: 'org2',
        period_month: '2026-06-01',
        fee_cents: 300,
        invoice_status: 'created',
        invoice_attempts: 0,
      }, // done
    ],
  }
}

describe('issueSettlementInvoices', () => {
  it('invoices only settlements with fee>0 and status none, and marks them created', async () => {
    const s = baseStore()
    const { deps, invoiced } = makeDeps(s, async () => ({ id: 'INV-1' }))
    const res = await issueSettlementInvoices(deps)

    expect(res).toEqual({
      processed: 2,
      created: 2,
      failed: 0,
      adopted: 0,
      sent: 0,
    })
    expect(invoiced.map((i) => i.amountCents).sort()).toEqual([500, 800])
    expect(invoiced[0].externalId).toBeTruthy()
    // customer details carried from the organizer
    expect(invoiced.find((i) => i.amountCents === 500)!.customer.name).toBe(
      'Firma A',
    )

    expect(s.settlements.find((x) => x.id === 's1')).toMatchObject({
      invoice_status: 'created',
      invoice_ref: 'INV-1',
    })
    expect(s.settlements.find((x) => x.id === 's3')!.invoice_status).toBe(
      'none',
    ) // fee 0 skipped
    expect(s.settlements.find((x) => x.id === 's4')!.invoice_status).toBe(
      'created',
    ) // untouched
  })

  it('marks a settlement failed when the provider throws', async () => {
    const s = baseStore()
    const { deps } = makeDeps(s, async (req) => {
      if (req.amountCents === 500) throw new Error('provider down')
      return { id: 'INV-9' }
    })
    const res = await issueSettlementInvoices(deps)
    expect(res).toEqual({
      processed: 2,
      created: 1,
      failed: 1,
      adopted: 0,
      sent: 0,
    })
    expect(s.settlements.find((x) => x.id === 's1')!.invoice_status).toBe(
      'failed',
    )
    expect(s.settlements.find((x) => x.id === 's2')!.invoice_status).toBe(
      'created',
    )
  })

  it('stores a newly created provider customer and reuses a known one', async () => {
    const s = baseStore()
    const { deps, invoiced } = makeDeps(s, async (req) => ({
      id: 'INV',
      customerId: req.customer.providerId ?? 'cust-a',
    }))
    await issueSettlementInvoices(deps)

    // org1 had none: the id comes back and is written to the organizer.
    expect(invoiced.find((i) => i.amountCents === 500)!.customer).toMatchObject(
      {
        externalId: 'org1',
        providerId: null,
        address: 'Hlavná 1, Poprad',
      },
    )
    expect(s.organizers.find((o) => o.id === 'org1')!.faktero_customer_id).toBe(
      'cust-a',
    )
    // org2 already had one: it is passed through and not rewritten.
    expect(
      invoiced.find((i) => i.amountCents === 800)!.customer.providerId,
    ).toBe('cust-b')
    expect(s.organizers.find((o) => o.id === 'org2')!.faktero_customer_id).toBe(
      'cust-b',
    )
  })

  it('leaves settlements alone when invoicing is not configured', async () => {
    const s = baseStore()
    const { deps, invoiced } = makeDeps(s, async () => ({ id: 'INV' }))
    const res = await issueSettlementInvoices({
      ...deps,
      configured: () => false,
    })

    expect(res).toEqual({
      processed: 0,
      created: 0,
      failed: 0,
      adopted: 0,
      sent: 0,
    })
    expect(invoiced).toHaveLength(0)
    // Still 'none', so they get invoiced once the provider is configured —
    // neither a made-up invoice_ref nor a dead-end 'failed'.
    expect(s.settlements.find((x) => x.id === 's1')!.invoice_status).toBe(
      'none',
    )
  })

  it('records the reason and counts the attempt when the provider throws', async () => {
    const s = baseStore()
    const { deps } = makeDeps(s, async (req) => {
      if (req.amountCents === 500) throw new Error('422 validation_error')
      return { id: 'INV-9' }
    })
    await issueSettlementInvoices(deps)

    expect(s.settlements.find((x) => x.id === 's1')).toMatchObject({
      invoice_status: 'failed',
      invoice_attempts: 1,
      invoice_error: '422 validation_error',
    })
  })

  it('retries a failed settlement and adopts an invoice the provider already has', async () => {
    const s = baseStore()
    const failed = s.settlements.find((x) => x.id === 's1')!
    failed.invoice_status = 'failed'
    failed.invoice_attempts = 1
    failed.invoice_error = 'timeout'

    const { deps, invoiced } = makeDeps(s, async () => ({ id: 'INV-NEW' }))
    const res = await issueSettlementInvoices({
      ...deps,
      findInvoice: async (id) =>
        id === 's1' ? { id: 'inv-abc', number: '20260901' } : null,
    })

    // No second invoice for s1 — the existing one is taken over.
    expect(invoiced.map((i) => i.externalId)).toEqual(['s2'])
    expect(res.adopted).toBe(1)
    expect(s.settlements.find((x) => x.id === 's1')).toMatchObject({
      invoice_status: 'created',
      invoice_ref: 'inv-abc', // the id, so a PDF can still be fetched
      invoice_number: '20260901',
      invoice_error: null,
    })
  })

  it('re-issues a failed settlement the provider does not know about', async () => {
    const s = baseStore()
    const failed = s.settlements.find((x) => x.id === 's1')!
    failed.invoice_status = 'failed'
    failed.invoice_attempts = 2

    const { deps, invoiced } = makeDeps(s, async () => ({ id: 'INV-NEW' }))
    const res = await issueSettlementInvoices({
      ...deps,
      findInvoice: async () => null,
    })

    expect(invoiced.map((i) => i.externalId).sort()).toEqual(['s1', 's2'])
    expect(res).toMatchObject({ created: 2, adopted: 0 })
    expect(s.settlements.find((x) => x.id === 's1')).toMatchObject({
      invoice_status: 'created',
      invoice_ref: 'INV-NEW',
      invoice_attempts: 3,
    })
  })

  it('leaves a failed settlement alone when the provider cannot be asked', async () => {
    const s = baseStore()
    const failed = s.settlements.find((x) => x.id === 's1')!
    failed.invoice_status = 'failed'
    failed.invoice_attempts = 1

    const { deps, invoiced } = makeDeps(s, async () => ({ id: 'INV-NEW' }))
    const res = await issueSettlementInvoices(deps) // no findInvoice

    expect(invoiced.map((i) => i.externalId)).toEqual(['s2'])
    expect(res).toMatchObject({ created: 1, adopted: 0, failed: 0 })
    expect(s.settlements.find((x) => x.id === 's1')!.invoice_status).toBe(
      'failed',
    )
  })

  it('does not keep retrying past the attempt ceiling', async () => {
    const s = baseStore()
    const failed = s.settlements.find((x) => x.id === 's1')!
    failed.invoice_status = 'failed'
    failed.invoice_attempts = MAX_INVOICE_ATTEMPTS

    const { deps, invoiced } = makeDeps(s, async () => ({ id: 'INV' }))
    await issueSettlementInvoices({ ...deps, findInvoice: async () => null })

    expect(invoiced.map((i) => i.externalId)).toEqual(['s2'])
  })

  it('counts a failed lookup as an attempt instead of invoicing blind', async () => {
    const s = baseStore()
    const failed = s.settlements.find((x) => x.id === 's1')!
    failed.invoice_status = 'failed'
    failed.invoice_attempts = 1

    const { deps, invoiced } = makeDeps(s, async () => ({ id: 'INV-NEW' }))
    const res = await issueSettlementInvoices({
      ...deps,
      findInvoice: async () => {
        throw new Error('503 nedostupné')
      },
    })

    expect(invoiced.map((i) => i.externalId)).toEqual(['s2'])
    expect(res.failed).toBe(1)
    expect(s.settlements.find((x) => x.id === 's1')).toMatchObject({
      invoice_status: 'failed',
      invoice_attempts: 2,
      invoice_error: '503 nedostupné',
    })
  })

  it('mails the invoices it has just issued and stamps them sent', async () => {
    const s = baseStore()
    const { deps } = makeDeps(s, async () => ({ id: 'inv-1' }))
    const sent: [string, string][] = []
    const res = await issueSettlementInvoices({
      ...deps,
      sendInvoice: async (id, email) => {
        sent.push([id, email])
      },
    })

    expect(sent).toEqual([
      ['inv-1', 'a@x.sk'],
      ['inv-1', 'b@x.sk'],
    ])
    expect(res.sent).toBe(2)
    expect(s.settlements.find((x) => x.id === 's1')!.invoice_sent_at).toBe(
      '2026-07-16T00:00:00.000Z',
    )
  })

  it('keeps a failed send out of the issuing queue and retries it later', async () => {
    const s = baseStore()
    const { deps } = makeDeps(s, async () => ({ id: 'inv-1' }))
    let attempt = 0
    const res = await issueSettlementInvoices({
      ...deps,
      sendInvoice: async () => {
        attempt++
        if (attempt === 1) throw new Error('550 mailbox unavailable')
      },
    })

    const s1 = s.settlements.find((x) => x.id === 's1')!
    // Still issued — re-issuing would bill the same month twice.
    expect(s1.invoice_status).toBe('created')
    expect(s1.invoice_ref).toBe('inv-1')
    expect(s1.invoice_sent_at ?? null).toBeNull()
    expect(s1.invoice_error).toBe('550 mailbox unavailable')
    expect(res.sent).toBe(1) // the other one went out

    // Next run picks it up again, because invoice_sent_at is still null.
    const again = await issueSettlementInvoices({
      ...deps,
      sendInvoice: async () => {},
    })
    expect(again.sent).toBe(1)
    expect(s.settlements.find((x) => x.id === 's1')!.invoice_sent_at).toBe(
      '2026-07-16T00:00:00.000Z',
    )
  })

  it('does not re-send an adopted invoice the provider already mailed', async () => {
    const s = baseStore()
    const failed = s.settlements.find((x) => x.id === 's1')!
    failed.invoice_status = 'failed'
    failed.invoice_attempts = 1

    const { deps } = makeDeps(s, async () => ({ id: 'inv-new' }))
    const sent: string[] = []
    await issueSettlementInvoices({
      ...deps,
      findInvoice: async (id) =>
        id === 's1'
          ? { id: 'inv-old', number: '1', sentAt: '2026-07-01T10:00:00Z' }
          : null,
      sendInvoice: async (id) => {
        sent.push(id)
      },
    })

    expect(sent).not.toContain('inv-old')
    expect(s.settlements.find((x) => x.id === 's1')!.invoice_sent_at).toBe(
      '2026-07-01T10:00:00Z',
    )
  })

  it('stops trying when the organizer has no e-mail to send to', async () => {
    const s = baseStore()
    s.organizers.find((o) => o.id === 'org1')!.email = null
    const { deps } = makeDeps(s, async () => ({ id: 'inv-1' }))
    const sent: string[] = []
    await issueSettlementInvoices({
      ...deps,
      sendInvoice: async (id) => {
        sent.push(id)
      },
    })

    const s1 = s.settlements.find((x) => x.id === 's1')!
    expect(sent).toHaveLength(1) // only org2's
    expect(s1.invoice_attempts).toBe(MAX_INVOICE_ATTEMPTS)
    expect(s1.invoice_error).toMatch(/nemá e-mail/)
  })

  it('skips the mailing pass when the provider cannot send', async () => {
    const s = baseStore()
    const { deps } = makeDeps(s, async () => ({ id: 'inv-1' }))
    const res = await issueSettlementInvoices(deps) // no sendInvoice

    expect(res.sent).toBe(0)
    expect(s.settlements.find((x) => x.id === 's1')!.invoice_sent_at).toBe(
      undefined,
    )
  })

  it('honours the batch limit', async () => {
    const s = baseStore()
    const { deps } = makeDeps(s, async () => ({ id: 'INV' }))
    const res = await issueSettlementInvoices(deps, { limit: 1 })
    expect(res.processed).toBe(1)
  })
})
