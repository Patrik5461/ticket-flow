import { describe, it, expect } from 'vitest'
import { buildDailySeries, fillDailySeries, dayKey } from './daily-series'
import type { DatedAmount } from './daily-series'

// Reference "now": 2026-07-15 14:00 CEST (Europe/Bratislava is UTC+2 in July).
const NOW = Date.parse('2026-07-15T12:00:00Z')

const order = (
  ts: string,
  cents: number,
  opts: { fallback?: boolean } = {},
): DatedAmount =>
  opts.fallback
    ? { total_cents: cents, paid_at: null, created_at: ts }
    : { total_cents: cents, paid_at: ts, created_at: '2000-01-01T00:00:00Z' }

const at = (series: { date: string }[], date: string) =>
  series.find((p) => p.date === date)

describe('buildDailySeries', () => {
  it('returns a 30-day window, oldest → newest, ending on the Bratislava day of now', () => {
    const series = buildDailySeries([], NOW)
    expect(series).toHaveLength(30)
    expect(series[0].date).toBe('2026-06-16')
    expect(series[29].date).toBe('2026-07-15')
    // strictly increasing, no gaps
    for (let i = 1; i < series.length; i++) {
      expect(series[i].date > series[i - 1].date).toBe(true)
    }
  })

  it('honours a custom window length', () => {
    const series = buildDailySeries([], NOW, 7)
    expect(series).toHaveLength(7)
    expect(series[0].date).toBe('2026-07-09')
    expect(series[6].date).toBe('2026-07-15')
  })

  it('zero-fills every day when there are no orders', () => {
    const series = buildDailySeries([], NOW)
    expect(series.every((p) => p.grossCents === 0 && p.orders === 0)).toBe(true)
  })

  it('sums gross and counts multiple orders on the same day', () => {
    const series = buildDailySeries(
      [order('2026-07-15T09:00:00Z', 1000), order('2026-07-15T20:00:00Z', 500)],
      NOW,
    )
    expect(at(series, '2026-07-15')).toMatchObject({
      grossCents: 1500,
      orders: 2,
    })
  })

  it('falls back to created_at when paid_at is null', () => {
    const series = buildDailySeries(
      [order('2026-07-10T10:00:00Z', 300, { fallback: true })],
      NOW,
    )
    expect(at(series, '2026-07-10')).toMatchObject({
      grossCents: 300,
      orders: 1,
    })
  })

  it('buckets by the Bratislava date, not the UTC date', () => {
    // 22:30Z on the 12th is 00:30 on the 13th in CEST → belongs to the 13th.
    const series = buildDailySeries([order('2026-07-12T22:30:00Z', 700)], NOW)
    expect(at(series, '2026-07-13')).toMatchObject({
      grossCents: 700,
      orders: 1,
    })
    expect(at(series, '2026-07-12')).toMatchObject({ grossCents: 0, orders: 0 })
  })

  it('ignores orders outside the window', () => {
    const series = buildDailySeries(
      [
        order('2026-07-15T09:00:00Z', 1000), // in window
        order('2026-05-01T10:00:00Z', 9999), // ~2.5 months ago, excluded
      ],
      NOW,
    )
    const totalOrders = series.reduce((s, p) => s + p.orders, 0)
    const totalGross = series.reduce((s, p) => s + p.grossCents, 0)
    expect(totalOrders).toBe(1)
    expect(totalGross).toBe(1000)
  })

  it('dayKey resolves an instant to its Bratislava calendar date', () => {
    // Late-evening UTC crosses into the next Bratislava day in summer.
    expect(dayKey(new Date('2026-07-12T22:30:00Z'))).toBe('2026-07-13')
    expect(dayKey(new Date('2026-07-12T21:30:00Z'))).toBe('2026-07-12')
  })
})

describe('fillDailySeries', () => {
  it('zero-fills the window and places sparse buckets on the right day', () => {
    const today = dayKey(new Date(NOW))
    const series = fillDailySeries(
      [{ date: today, grossCents: 5000, orders: 3 }],
      NOW,
      30,
    )
    expect(series).toHaveLength(30)
    expect(series[29]).toEqual({ date: today, grossCents: 5000, orders: 3 })
    expect(series[0].grossCents).toBe(0)
    expect(series[0].orders).toBe(0)
  })
  it('ignores buckets outside the window', () => {
    const series = fillDailySeries(
      [{ date: '2020-01-01', grossCents: 999, orders: 9 }],
      NOW,
      30,
    )
    expect(series.every((p) => p.grossCents === 0)).toBe(true)
  })
})
