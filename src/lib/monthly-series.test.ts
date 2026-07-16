import { describe, it, expect } from 'vitest'
import { buildMonthlySeries, monthKey } from './monthly-series'

// 2026-03-15T12:00:00Z → March 2026 in Bratislava.
const NOW = Date.parse('2026-03-15T12:00:00.000Z')

describe('monthKey', () => {
  it('returns YYYY-MM in Europe/Bratislava', () => {
    expect(monthKey(new Date('2026-03-15T12:00:00Z'))).toBe('2026-03')
    // 2025-12-31 23:30 UTC is still December in Bratislava (+1).
    expect(monthKey(new Date('2025-12-31T23:30:00Z'))).toBe('2026-01')
  })
})

describe('buildMonthlySeries', () => {
  it('produces a zero-filled window oldest → newest', () => {
    const s = buildMonthlySeries([], NOW, 3)
    expect(s.map((p) => p.month)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(s.every((p) => p.grossCents === 0 && p.feeCents === 0)).toBe(true)
  })

  it('buckets gross + fee by month and ignores out-of-window', () => {
    const s = buildMonthlySeries(
      [
        {
          total_cents: 1000,
          fee_cents: 40,
          paid_at: '2026-03-02T10:00:00Z',
          created_at: 'x',
        },
        {
          total_cents: 500,
          fee_cents: 20,
          paid_at: '2026-02-10T10:00:00Z',
          created_at: 'x',
        },
        {
          total_cents: 999,
          fee_cents: 50,
          paid_at: '2025-11-01T10:00:00Z',
          created_at: 'x',
        }, // out
      ],
      NOW,
      3,
    )
    const byMonth = Object.fromEntries(s.map((p) => [p.month, p]))
    expect(byMonth['2026-03'].grossCents).toBe(1000)
    expect(byMonth['2026-03'].feeCents).toBe(40)
    expect(byMonth['2026-02'].grossCents).toBe(500)
    expect(byMonth['2026-01'].grossCents).toBe(0)
  })

  it('falls back to created_at when paid_at is null', () => {
    const s = buildMonthlySeries(
      [
        {
          total_cents: 300,
          fee_cents: 12,
          paid_at: null,
          created_at: '2026-03-05T10:00:00Z',
        },
      ],
      NOW,
      2,
    )
    expect(s.find((p) => p.month === '2026-03')?.grossCents).toBe(300)
  })
})
