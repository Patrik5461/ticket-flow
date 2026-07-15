import { describe, it, expect } from 'vitest'
import { ticketRefundCents, orderStatusAfterRefund } from './refunds'

describe('ticketRefundCents', () => {
  it('refunds the full unit price when there is no discount', () => {
    expect(
      ticketRefundCents({
        unitPriceCents: 1500,
        subtotalCents: 5000,
        totalCents: 5000,
        remainingCents: 5000,
      }),
    ).toBe(1500)
  })

  it('shares an order-level discount proportionally by list price', () => {
    // 10% off: total 4500 of subtotal 5000. A 1500 ticket → 1350.
    expect(
      ticketRefundCents({
        unitPriceCents: 1500,
        subtotalCents: 5000,
        totalCents: 4500,
        remainingCents: 4500,
      }),
    ).toBe(1350)
  })

  it('never refunds more than what remains', () => {
    expect(
      ticketRefundCents({
        unitPriceCents: 3500,
        subtotalCents: 5000,
        totalCents: 5000,
        remainingCents: 1000,
      }),
    ).toBe(1000)
  })

  it('is zero for a free order, zero subtotal, or nothing remaining', () => {
    const base = { unitPriceCents: 1500, subtotalCents: 5000, totalCents: 5000 }
    expect(ticketRefundCents({ ...base, totalCents: 0, remainingCents: 0 })).toBe(0)
    expect(ticketRefundCents({ ...base, subtotalCents: 0, remainingCents: 5000 })).toBe(0)
    expect(ticketRefundCents({ ...base, remainingCents: 0 })).toBe(0)
  })
})

describe('orderStatusAfterRefund', () => {
  it('is refunded when no active tickets remain, otherwise partially_refunded', () => {
    expect(orderStatusAfterRefund(0)).toBe('refunded')
    expect(orderStatusAfterRefund(1)).toBe('partially_refunded')
    expect(orderStatusAfterRefund(3)).toBe('partially_refunded')
  })
})
