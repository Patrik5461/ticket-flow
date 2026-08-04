import { describe, it, expect } from 'vitest'
import {
  computeRealizedRevenue,
  isRealizedOrder,
  refundCounts,
  REALIZED_ORDER_STATUSES,
} from './realized-revenue'
import type { RevenueOrder, RevenueRefund } from './realized-revenue'
import type { OrderStatus } from '../lib/db-types'

const o = (
  status: OrderStatus,
  total_cents: number,
  fee_cents: number,
): RevenueOrder => ({ status, total_cents, fee_cents })

const r = (amount_cents: number, status = 'done'): RevenueRefund => ({
  amount_cents,
  status,
})

describe('isRealizedOrder', () => {
  it('counts paid, partially_refunded and refunded as money collected', () => {
    for (const s of [
      'paid',
      'partially_refunded',
      'refunded',
    ] as OrderStatus[]) {
      expect(isRealizedOrder(s)).toBe(true)
    }
    expect(REALIZED_ORDER_STATUSES).toEqual([
      'paid',
      'partially_refunded',
      'refunded',
    ])
  })

  it('excludes pending, expired and cancelled', () => {
    for (const s of ['pending', 'expired', 'cancelled'] as OrderStatus[]) {
      expect(isRealizedOrder(s)).toBe(false)
    }
  })
})

describe('refundCounts', () => {
  it('counts done and requested, but never failed', () => {
    expect(refundCounts('done')).toBe(true)
    expect(refundCounts('requested')).toBe(true)
    expect(refundCounts('failed')).toBe(false)
  })
})

describe('computeRealizedRevenue', () => {
  it('nets refunds and keeps the fee: net = gross − fee − refunded', () => {
    const res = computeRealizedRevenue(
      [
        o('paid', 5000, 200),
        o('refunded', 3000, 120),
        o('partially_refunded', 2000, 80),
        o('pending', 9999, 400), // excluded
        o('cancelled', 8888, 350), // excluded
      ],
      [r(3000), r(500), r(700, 'failed')],
    )
    expect(res).toEqual({
      grossCents: 10000, // 5000 + 3000 + 2000
      feeCents: 400, // 200 + 120 + 80
      refundedCents: 3500, // 3000 + 500; failed 700 excluded
      netCents: 6100, // 10000 − 400 − 3500
      orderCount: 3,
    })
  })

  it('a fully refunded order yields a negative net of exactly the kept fee', () => {
    // One €30 order, €1.20 fee, fully refunded. The platform keeps the fee, so
    // the organizer's realized net is −fee — never a mysterious number.
    const res = computeRealizedRevenue([o('refunded', 3000, 120)], [r(3000)])
    expect(res.grossCents).toBe(3000)
    expect(res.feeCents).toBe(120)
    expect(res.refundedCents).toBe(3000)
    expect(res.netCents).toBe(-120)
  })

  it('is all zeros for no orders and no refunds', () => {
    expect(computeRealizedRevenue([], [])).toEqual({
      grossCents: 0,
      feeCents: 0,
      refundedCents: 0,
      netCents: 0,
      orderCount: 0,
    })
  })
})
