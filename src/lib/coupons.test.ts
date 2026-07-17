import { describe, it, expect } from 'vitest'
import { couponDiscountCents, validateCoupon } from './coupons'
import type { CouponLike } from './coupons'

const base: CouponLike = {
  code: 'TEST',
  type: 'percent',
  value: 10,
  max_uses: null,
  used_count: 0,
  valid_from: null,
  valid_until: null,
}

describe('validateCoupon', () => {
  const now = new Date('2026-07-15T12:00:00Z')

  it('accepts an always-valid coupon', () => {
    expect(validateCoupon(base, now)).toEqual({ ok: true })
  })

  it('rejects before valid_from', () => {
    expect(
      validateCoupon({ ...base, valid_from: '2026-08-01T00:00:00Z' }, now),
    ).toEqual({ ok: false, reason: 'not_yet_valid' })
  })

  it('rejects after valid_until', () => {
    expect(
      validateCoupon({ ...base, valid_until: '2026-07-01T00:00:00Z' }, now),
    ).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects when max_uses is exhausted', () => {
    expect(
      validateCoupon({ ...base, max_uses: 5, used_count: 5 }, now),
    ).toEqual({ ok: false, reason: 'exhausted' })
  })
})

describe('couponDiscountCents', () => {
  it('computes a percent discount and floors to cents', () => {
    // 10% of 1999 = 199.9 -> 199
    expect(couponDiscountCents({ type: 'percent', value: 10 }, 1999)).toBe(199)
  })

  it('applies a fixed discount', () => {
    expect(couponDiscountCents({ type: 'fixed', value: 300 }, 1000)).toBe(300)
  })

  it('never exceeds the subtotal', () => {
    expect(couponDiscountCents({ type: 'fixed', value: 5000 }, 1000)).toBe(1000)
  })

  it('is zero for an empty cart', () => {
    expect(couponDiscountCents({ type: 'percent', value: 50 }, 0)).toBe(0)
  })
})
