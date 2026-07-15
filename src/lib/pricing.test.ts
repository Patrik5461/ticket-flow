import { describe, it, expect } from 'vitest'
import { computeFee, computePricing, computeSubtotal } from './pricing'

describe('computeSubtotal', () => {
  it('sums quantity × unit price in cents', () => {
    expect(
      computeSubtotal([
        { quantity: 2, unitPriceCents: 1500 },
        { quantity: 1, unitPriceCents: 500 },
      ]),
    ).toBe(3500)
  })

  it('is zero for an empty cart', () => {
    expect(computeSubtotal([])).toBe(0)
  })
})

describe('computeFee', () => {
  it('takes the percentage when above the minimum', () => {
    // 4% of 5000 = 200 > min 40
    expect(computeFee(5000, 4.0, 40)).toBe(200)
  })

  it('falls back to the minimum for small amounts', () => {
    // 4% of 100 = 4 < min 40
    expect(computeFee(100, 4.0, 40)).toBe(40)
  })

  it('is zero for a free order', () => {
    expect(computeFee(0, 4.0, 40)).toBe(0)
  })

  it('rounds to whole cents', () => {
    // 4% of 1010 = 40.4 -> 40
    expect(computeFee(1010, 4.0, 40)).toBe(40)
    // 4% of 1030 = 41.2 -> 41
    expect(computeFee(1030, 4.0, 40)).toBe(41)
  })
})

describe('computePricing', () => {
  it('computes subtotal, discount, total and fee with a percent coupon', () => {
    const p = computePricing({
      items: [{ quantity: 2, unitPriceCents: 2500 }],
      coupon: { type: 'percent', value: 10 },
      feePercent: 4.0,
      feeMinCents: 40,
    })
    expect(p.subtotalCents).toBe(5000)
    expect(p.discountCents).toBe(500)
    expect(p.totalCents).toBe(4500)
    expect(p.feeCents).toBe(180) // 4% of 4500
  })

  it('caps a fixed coupon at the subtotal and charges no fee on a free result', () => {
    const p = computePricing({
      items: [{ quantity: 1, unitPriceCents: 1000 }],
      coupon: { type: 'fixed', value: 5000 },
      feePercent: 4.0,
      feeMinCents: 40,
    })
    expect(p.discountCents).toBe(1000)
    expect(p.totalCents).toBe(0)
    expect(p.feeCents).toBe(0)
  })

  it('works without a coupon', () => {
    const p = computePricing({
      items: [{ quantity: 3, unitPriceCents: 1000 }],
      coupon: null,
      feePercent: 4.0,
      feeMinCents: 40,
    })
    expect(p).toEqual({
      subtotalCents: 3000,
      discountCents: 0,
      totalCents: 3000,
      feeCents: 120,
    })
  })
})
