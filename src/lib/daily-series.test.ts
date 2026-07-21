import { describe, it, expect } from 'vitest'
import {
  buildDailySeries,
  fillDailySeries,
  dayKey,
  buildHourlySeries,
  buildDayRangeSeries,
} from './daily-series'
import type { DatedAmount, DatedOrder } from './daily-series'

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

// ---------------------------------------------------------------------------
// Phase 24 — hourly + arbitrary-range bucketing for the organizer's chart.
// ---------------------------------------------------------------------------

describe('buildHourlySeries', () => {
  const TZ = 'Europe/Bratislava'
  const paidOrder = (iso: string, cents = 1000, tickets = 1): DatedOrder => ({
    total_cents: cents,
    paid_at: iso,
    created_at: iso,
    tickets,
  })

  it('covers a normal day with 24 hourly buckets, labelled locally', () => {
    const series = buildHourlySeries([], '2026-07-20', TZ)
    expect(series).toHaveLength(24)
    expect(series[0].label).toBe('00:00')
    expect(series[23].label).toBe('23:00')
    expect(series[0].key).toBe('2026-07-20T00')
  })

  it('buckets by local time, not UTC', () => {
    // 20:30 UTC in July (CEST, +2) is 22:30 in Bratislava — the 22:00 bucket.
    const series = buildHourlySeries(
      [paidOrder('2026-07-20T20:30:00.000Z', 2500, 2)],
      '2026-07-20',
      TZ,
    )
    const at22 = series.find((p) => p.label === '22:00')!
    expect(at22).toMatchObject({ grossCents: 2500, orders: 1, tickets: 2 })
    expect(series.reduce((s, p) => s + p.orders, 0)).toBe(1)
  })

  it('falls back to created_at when the order has no paid_at', () => {
    const series = buildHourlySeries(
      [
        {
          total_cents: 500,
          paid_at: null,
          created_at: '2026-07-20T08:10:00.000Z', // 10:10 local
          tickets: 1,
        },
      ],
      '2026-07-20',
      TZ,
    )
    expect(series.find((p) => p.label === '10:00')?.grossCents).toBe(500)
  })

  it('spring forward: the day has 23 buckets and no 02:00', () => {
    // 2026-03-29, Europe/Bratislava jumps 02:00 -> 03:00.
    const series = buildHourlySeries([], '2026-03-29', TZ)
    expect(series).toHaveLength(23)
    expect(series.map((p) => p.label)).not.toContain('02:00')
    expect(series[1].label).toBe('01:00')
    expect(series[2].label).toBe('03:00')
  })

  it('fall back: the repeated 02:00 hour merges into one bucket', () => {
    // 2026-10-25, Europe/Bratislava repeats 02:00 (CEST then CET).
    const series = buildHourlySeries(
      [
        paidOrder('2026-10-25T00:30:00.000Z'), // 02:30 CEST
        paidOrder('2026-10-25T01:30:00.000Z'), // 02:30 CET (the repeat)
      ],
      '2026-10-25',
      TZ,
    )
    const at02 = series.filter((p) => p.label === '02:00')
    expect(at02).toHaveLength(1)
    expect(at02[0].orders).toBe(2)
    // 25 real hours, 24 distinct local labels.
    expect(series).toHaveLength(24)
  })

  it('ignores orders from other days', () => {
    const series = buildHourlySeries(
      [paidOrder('2026-07-19T10:00:00.000Z'), paidOrder('2026-07-21T10:00:00.000Z')],
      '2026-07-20',
      TZ,
    )
    expect(series.reduce((s, p) => s + p.orders, 0)).toBe(0)
  })
})

describe('buildDayRangeSeries', () => {
  const TZ = 'Europe/Bratislava'
  const paidOrder = (iso: string, cents = 1000, tickets = 1): DatedOrder => ({
    total_cents: cents,
    paid_at: iso,
    created_at: iso,
    tickets,
  })

  it('is inclusive on both ends and zero-fills the gap', () => {
    const series = buildDayRangeSeries([], '2026-07-01', '2026-07-05', TZ)
    expect(series.map((p) => p.key)).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
    ])
    expect(series[0].label).toBe('1.7.')
    expect(series.every((p) => p.grossCents === 0)).toBe(true)
  })

  it('steps cleanly across a DST change — no skipped or duplicated day', () => {
    const spring = buildDayRangeSeries([], '2026-03-27', '2026-03-31', TZ)
    expect(spring.map((p) => p.key)).toEqual([
      '2026-03-27',
      '2026-03-28',
      '2026-03-29', // 23-hour day
      '2026-03-30',
      '2026-03-31',
    ])
    const autumn = buildDayRangeSeries([], '2026-10-23', '2026-10-27', TZ)
    expect(autumn.map((p) => p.key)).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-10-25', // 25-hour day
      '2026-10-26',
      '2026-10-27',
    ])
  })

  it('sums money, orders and ticket quantities per day', () => {
    const series = buildDayRangeSeries(
      [
        paidOrder('2026-07-02T09:00:00.000Z', 1500, 2),
        paidOrder('2026-07-02T18:00:00.000Z', 500, 1),
        paidOrder('2026-07-03T09:00:00.000Z', 2000, 4),
      ],
      '2026-07-01',
      '2026-07-03',
      TZ,
    )
    expect(series[1]).toMatchObject({ grossCents: 2000, orders: 2, tickets: 3 })
    expect(series[2]).toMatchObject({ grossCents: 2000, orders: 1, tickets: 4 })
  })

  it('an order just before local midnight belongs to that local day', () => {
    // 21:30 UTC on 1 July is 23:30 local — still the 1st, not the 2nd.
    const series = buildDayRangeSeries(
      [paidOrder('2026-07-01T21:30:00.000Z')],
      '2026-07-01',
      '2026-07-02',
      TZ,
    )
    expect(series[0].orders).toBe(1)
    expect(series[1].orders).toBe(0)
  })

  it('caps a runaway range instead of building thousands of points', () => {
    const series = buildDayRangeSeries([], '2020-01-01', '2026-01-01', TZ, 30)
    expect(series).toHaveLength(30)
  })
})
