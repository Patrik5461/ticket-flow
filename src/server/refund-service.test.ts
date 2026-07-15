import { describe, it, expect, beforeEach } from 'vitest'
import {
  refundWholeOrder,
  refundSingleTicket,
  RefundError,
} from './refund-service'
import type { RefundDeps, RefundEmail, RefundAudit } from './refund-service'

// --- in-memory fake DB (same shape trick as checkin-service.test) ------------

interface Store {
  orders: Record<string, any>[]
  events: Record<string, any>[]
  tickets: Record<string, any>[]
  order_items: Record<string, any>[]
  refunds: Record<string, any>[]
}

class Builder {
  private op: 'select' | 'update' | 'insert' = 'select'
  private mutated = false
  private values: Record<string, unknown> = {}
  private eqs: [string, unknown][] = []
  private neqs: [string, unknown][] = []

  constructor(
    private store: Store,
    private table: keyof Store,
  ) {}

  select() {
    if (!this.mutated) this.op = 'select'
    return this
  }
  update(values: Record<string, unknown>) {
    this.op = 'update'
    this.mutated = true
    this.values = values
    return this
  }
  insert(values: Record<string, unknown>) {
    this.op = 'insert'
    this.mutated = true
    this.values = values
    return this
  }
  eq(c: string, v: unknown) {
    this.eqs.push([c, v])
    return this
  }
  neq(c: string, v: unknown) {
    this.neqs.push([c, v])
    return this
  }

  private matched() {
    return this.store[this.table].filter(
      (r) =>
        this.eqs.every(([c, v]) => r[c] === v) &&
        this.neqs.every(([c, v]) => r[c] !== v),
    )
  }
  private run(single: boolean) {
    if (this.op === 'insert') {
      this.store[this.table].push({
        id: `row-${this.store[this.table].length + 1}`,
        ...this.values,
      })
      return { data: null, error: null }
    }
    if (this.op === 'update') {
      const rows = this.matched()
      for (const r of rows) Object.assign(r, this.values)
      return { data: rows, error: null }
    }
    // Reads return detached copies (real Supabase does not hand back live rows),
    // so a later in-place update never leaks into an already-read object.
    const rows = this.matched().map((r) => ({ ...r }))
    return single
      ? { data: rows[0] ?? null, error: null }
      : { data: rows, error: null }
  }
  maybeSingle() {
    return Promise.resolve(this.run(true))
  }
  then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
    return Promise.resolve(this.run(false)).then(resolve, reject)
  }
}

function makeDeps(
  store: Store,
  opts: {
    refund?: (paymentId: string, amountCents: number) => Promise<{ id: string }>
  } = {},
) {
  const emails: RefundEmail[] = []
  const audits: RefundAudit[] = []
  const gopayCalls: { paymentId: string; amountCents: number }[] = []
  const rpcCalls: unknown[] = []

  const deps: RefundDeps = {
    db: {
      from: (t: string) => new Builder(store, t as keyof Store),
      rpc: (_fn: string, args: unknown) => {
        rpcCalls.push(args)
        return Promise.resolve({ data: null, error: null })
      },
    },
    gopay: {
      refund:
        opts.refund ??
        (async (paymentId, amountCents) => {
          gopayCalls.push({ paymentId, amountCents })
          return { id: 'gp_refund_1' }
        }),
    },
    sendRefundEmail: async (m) => {
      emails.push(m)
    },
    writeAudit: async (a) => {
      audits.push(a)
    },
    now: () => '2026-07-15T18:00:00.000Z',
  }
  // wrap the default gopay to also record calls
  if (!opts.refund) {
    const inner = deps.gopay.refund
    deps.gopay.refund = async (p, a) => {
      const r = await inner(p, a)
      return r
    }
  }
  return { deps, emails, audits, gopayCalls, rpcCalls }
}

const ORDER = 'o1'
const EVENT = 'e1'
const PAYMENT = 'pay_123'

function paidStore(): Store {
  return {
    orders: [
      {
        id: ORDER,
        event_id: EVENT,
        status: 'paid',
        subtotal_cents: 5000,
        total_cents: 5000,
        gopay_payment_id: PAYMENT,
        buyer_email: 'buyer@example.com',
      },
    ],
    events: [{ id: EVENT, title: 'Letný festival' }],
    order_items: [
      { order_id: ORDER, ticket_type_id: 'vip', unit_price_cents: 3500 },
      { order_id: ORDER, ticket_type_id: 'std', unit_price_cents: 1500 },
    ],
    tickets: [
      { id: 't-vip', order_id: ORDER, ticket_type_id: 'vip', status: 'valid' },
      { id: 't-std', order_id: ORDER, ticket_type_id: 'std', status: 'valid' },
    ],
    refunds: [],
  }
}

describe('refundWholeOrder', () => {
  let store: Store
  beforeEach(() => {
    store = paidStore()
  })

  it('refunds the full total, cancels all tickets, sets status refunded, audits + emails', async () => {
    const { deps, emails, audits, gopayCalls } = makeDeps(store)
    const res = await refundWholeOrder(deps, {
      orderId: ORDER,
      actorId: 'admin-1',
    })

    expect(res).toMatchObject({
      ok: true,
      refundedCents: 5000,
      orderStatus: 'refunded',
    })
    expect(gopayCalls).toEqual([{ paymentId: PAYMENT, amountCents: 5000 }])
    expect(store.orders[0].status).toBe('refunded')
    expect(store.tickets.every((t) => t.status === 'cancelled')).toBe(true)
    expect(store.refunds).toHaveLength(1)
    expect(store.refunds[0]).toMatchObject({
      amount_cents: 5000,
      status: 'done',
      gopay_refund_id: 'gp_refund_1',
    })
    expect(audits[0]).toMatchObject({
      action: 'order.refund',
      oldStatus: 'paid',
      newStatus: 'refunded',
      amountCents: 5000,
    })
    expect(emails[0]).toMatchObject({
      full: true,
      amountCents: 5000,
      to: 'buyer@example.com',
    })
  })

  it('is a no-op on an already fully refunded order', async () => {
    store.orders[0].status = 'refunded'
    const { deps, gopayCalls } = makeDeps(store)
    const res = await refundWholeOrder(deps, {
      orderId: ORDER,
      actorId: 'admin-1',
    })
    expect(res.refundedCents).toBe(0)
    expect(gopayCalls).toHaveLength(0)
  })

  it('only refunds the remaining balance after a partial refund', async () => {
    store.orders[0].status = 'partially_refunded'
    store.refunds.push({
      id: 'r0',
      order_id: ORDER,
      amount_cents: 3500,
      status: 'done',
    })
    const { deps, gopayCalls } = makeDeps(store)
    const res = await refundWholeOrder(deps, {
      orderId: ORDER,
      actorId: 'admin-1',
    })
    expect(res.refundedCents).toBe(1500)
    expect(gopayCalls).toEqual([{ paymentId: PAYMENT, amountCents: 1500 }])
    expect(store.orders[0].status).toBe('refunded')
  })

  it('rejects a non-refundable order status', async () => {
    store.orders[0].status = 'pending'
    const { deps } = makeDeps(store)
    await expect(
      refundWholeOrder(deps, { orderId: ORDER, actorId: 'admin-1' }),
    ).rejects.toBeInstanceOf(RefundError)
  })

  it('records a failed refund and does not cancel tickets when the gateway throws', async () => {
    const { deps } = makeDeps(store, {
      refund: async () => {
        throw new Error('gateway down')
      },
    })
    await expect(
      refundWholeOrder(deps, { orderId: ORDER, actorId: 'admin-1' }),
    ).rejects.toBeInstanceOf(RefundError)
    expect(store.refunds[0]).toMatchObject({
      status: 'failed',
      amount_cents: 5000,
    })
    expect(store.orders[0].status).toBe('paid') // unchanged
    expect(store.tickets.every((t) => t.status === 'valid')).toBe(true)
  })
})

describe('refundSingleTicket', () => {
  it('refunds one ticket proportionally and marks the order partially_refunded', async () => {
    // 10% discount: total 4500 of subtotal 5000.
    const store = paidStore()
    store.orders[0].total_cents = 4500
    const { deps, gopayCalls, emails } = makeDeps(store)

    const res = await refundSingleTicket(deps, {
      ticketId: 't-vip',
      actorId: 'org-1',
    })
    // VIP 3500 share of 4500/5000 = 3150.
    expect(res).toMatchObject({
      ok: true,
      refundedCents: 3150,
      orderStatus: 'partially_refunded',
    })
    expect(gopayCalls).toEqual([{ paymentId: PAYMENT, amountCents: 3150 }])
    expect(store.tickets.find((t) => t.id === 't-vip')!.status).toBe(
      'cancelled',
    )
    expect(store.tickets.find((t) => t.id === 't-std')!.status).toBe('valid')
    expect(store.orders[0].status).toBe('partially_refunded')
    expect(store.refunds[0]).toMatchObject({
      ticket_id: 't-vip',
      amount_cents: 3150,
    })
    expect(emails[0]).toMatchObject({ full: false, amountCents: 3150 })
  })

  it('refunding the last active ticket flips the order to refunded, capped at remaining', async () => {
    const store = paidStore()
    store.orders[0].total_cents = 4500
    store.orders[0].status = 'partially_refunded'
    store.tickets.find((t) => t.id === 't-vip')!.status = 'cancelled'
    store.refunds.push({
      id: 'r0',
      order_id: ORDER,
      amount_cents: 3150,
      status: 'done',
    })
    const { deps, gopayCalls } = makeDeps(store)

    const res = await refundSingleTicket(deps, {
      ticketId: 't-std',
      actorId: 'org-1',
    })
    // remaining = 4500-3150 = 1350; STD share round(1500*4500/5000)=1350 → 1350.
    expect(res).toMatchObject({ refundedCents: 1350, orderStatus: 'refunded' })
    expect(gopayCalls).toEqual([{ paymentId: PAYMENT, amountCents: 1350 }])
    expect(store.orders[0].status).toBe('refunded')
  })

  it('handles a free ticket with no gateway call', async () => {
    const store: Store = {
      orders: [
        {
          id: ORDER,
          event_id: EVENT,
          status: 'paid',
          subtotal_cents: 0,
          total_cents: 0,
          gopay_payment_id: null,
          buyer_email: 'buyer@example.com',
        },
      ],
      events: [{ id: EVENT, title: 'Free event' }],
      order_items: [
        { order_id: ORDER, ticket_type_id: 'free', unit_price_cents: 0 },
      ],
      tickets: [
        {
          id: 't-free',
          order_id: ORDER,
          ticket_type_id: 'free',
          status: 'valid',
        },
      ],
      refunds: [],
    }
    const { deps, gopayCalls } = makeDeps(store)
    const res = await refundSingleTicket(deps, {
      ticketId: 't-free',
      actorId: 'org-1',
    })
    expect(res).toMatchObject({ refundedCents: 0, orderStatus: 'refunded' })
    expect(gopayCalls).toHaveLength(0)
    expect(store.refunds[0]).toMatchObject({ amount_cents: 0, status: 'done' })
    expect(store.tickets[0].status).toBe('cancelled')
  })

  it('refuses to refund an already-cancelled ticket', async () => {
    const store = paidStore()
    store.tickets.find((t) => t.id === 't-vip')!.status = 'cancelled'
    const { deps } = makeDeps(store)
    await expect(
      refundSingleTicket(deps, { ticketId: 't-vip', actorId: 'org-1' }),
    ).rejects.toBeInstanceOf(RefundError)
  })
})
