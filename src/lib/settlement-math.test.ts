import { describe, it, expect } from 'vitest'
import { settlementNet, sumRefunds } from './settlement-math'

describe('sumRefunds', () => {
  it('sums non-failed refunds only', () => {
    expect(
      sumRefunds([
        { amount_cents: 500, status: 'done' },
        { amount_cents: 300, status: 'failed' },
        { amount_cents: 200, status: 'pending' },
      ]),
    ).toBe(700)
  })
})

describe('settlementNet', () => {
  const orders = [
    { total_cents: 1000, fee_cents: 40 },
    { total_cents: 2000, fee_cents: 80 },
  ]

  it('net = gross − fee with no refunds', () => {
    expect(settlementNet(orders, [])).toBe(3000 - 120)
  })

  it('subtracts a partial refund', () => {
    // 2880 − 500 = 2380
    expect(settlementNet(orders, [{ amount_cents: 500, status: 'done' }])).toBe(
      2380,
    )
  })

  it('ignores failed refunds', () => {
    expect(
      settlementNet(orders, [{ amount_cents: 500, status: 'failed' }]),
    ).toBe(2880)
  })
})
