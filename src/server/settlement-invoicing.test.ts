import { describe, it, expect } from 'vitest'
import { issueSettlementInvoices } from './settlement-invoicing'
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
  limit(n: number) {
    this.lim = n
    return this
  }
  private matched() {
    let rows = this.store[this.table].filter(
      (r) =>
        this.eqs.every(([c, v]) => r[c] === v) &&
        this.gts.every(([c, v]) => r[c] > v),
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
  createInvoice: (req: InvoiceRequest) => Promise<{ id: string }>,
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
      },
      {
        id: 'org2',
        name: 'Firma B',
        ico: '222',
        dic: null,
        ic_dph: null,
        email: 'b@x.sk',
      },
    ],
    settlements: [
      {
        id: 's1',
        organizer_id: 'org1',
        period_month: '2026-06-01',
        fee_cents: 500,
        invoice_status: 'none',
      },
      {
        id: 's2',
        organizer_id: 'org2',
        period_month: '2026-06-01',
        fee_cents: 800,
        invoice_status: 'none',
      },
      {
        id: 's3',
        organizer_id: 'org1',
        period_month: '2026-06-01',
        fee_cents: 0,
        invoice_status: 'none',
      }, // no fee
      {
        id: 's4',
        organizer_id: 'org2',
        period_month: '2026-06-01',
        fee_cents: 300,
        invoice_status: 'created',
      }, // done
    ],
  }
}

describe('issueSettlementInvoices', () => {
  it('invoices only settlements with fee>0 and status none, and marks them created', async () => {
    const s = baseStore()
    const { deps, invoiced } = makeDeps(s, async () => ({ id: 'INV-1' }))
    const res = await issueSettlementInvoices(deps)

    expect(res).toEqual({ processed: 2, created: 2, failed: 0 })
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
    expect(res).toEqual({ processed: 2, created: 1, failed: 1 })
    expect(s.settlements.find((x) => x.id === 's1')!.invoice_status).toBe(
      'failed',
    )
    expect(s.settlements.find((x) => x.id === 's2')!.invoice_status).toBe(
      'created',
    )
  })

  it('honours the batch limit', async () => {
    const s = baseStore()
    const { deps } = makeDeps(s, async () => ({ id: 'INV' }))
    const res = await issueSettlementInvoices(deps, { limit: 1 })
    expect(res.processed).toBe(1)
  })
})
