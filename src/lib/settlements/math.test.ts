import { describe, it, expect } from 'vitest'
import { summarizeSettlementOrders } from './math'

describe('summarizeSettlementOrders', () => {
  it('sums gross/fee/refunded and derives net = gross − fee − refunded', () => {
    const totals = summarizeSettlementOrders([
      { totalCents: 5000, feeCents: 200, refundedCents: 0 },
      { totalCents: 3500, feeCents: 140, refundedCents: 3500 }, // fully refunded
      { totalCents: 1500, feeCents: 60, refundedCents: 500 }, // partial
    ])
    expect(totals).toEqual({
      grossCents: 10000,
      feeCents: 400,
      refundedCents: 4000,
      netCents: 5600, // 10000 − 400 − 4000
      orderCount: 3,
    })
  })

  it('is all-zero for an empty period', () => {
    expect(summarizeSettlementOrders([])).toEqual({
      grossCents: 0,
      feeCents: 0,
      refundedCents: 0,
      netCents: 0,
      orderCount: 0,
    })
  })

  it('reconciles to the cent with per-order lines', () => {
    const orders = [
      { totalCents: 1234, feeCents: 49, refundedCents: 0 },
      { totalCents: 6789, feeCents: 271, refundedCents: 1000 },
    ]
    const t = summarizeSettlementOrders(orders)
    // gross must equal the sum of the order totals shown on the PDF
    expect(t.grossCents).toBe(orders.reduce((s, o) => s + o.totalCents, 0))
    expect(t.netCents).toBe(t.grossCents - t.feeCents - t.refundedCents)
  })
})
