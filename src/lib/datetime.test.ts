import { describe, it, expect } from 'vitest'
import { zonedLocalToUtcIso, utcIsoToZonedLocal, formatSk } from './datetime'

const TZ = 'Europe/Bratislava'

describe('zonedLocalToUtcIso', () => {
  it('converts summer (CEST, +02:00) wall time to UTC', () => {
    expect(zonedLocalToUtcIso('2026-08-01T20:00', TZ)).toBe(
      '2026-08-01T18:00:00.000Z',
    )
  })

  it('converts winter (CET, +01:00) wall time to UTC', () => {
    expect(zonedLocalToUtcIso('2026-01-15T20:00', TZ)).toBe(
      '2026-01-15T19:00:00.000Z',
    )
  })
})

describe('utcIsoToZonedLocal', () => {
  it('formats a UTC instant as local wall time (summer)', () => {
    expect(utcIsoToZonedLocal('2026-08-01T18:00:00.000Z', TZ)).toBe(
      '2026-08-01T20:00',
    )
  })

  it('round-trips local -> utc -> local', () => {
    const local = '2026-09-20T19:30'
    expect(utcIsoToZonedLocal(zonedLocalToUtcIso(local, TZ), TZ)).toBe(local)
  })
})

describe('formatSk', () => {
  // 2026-07-29 22:09:07 wall time in Bratislava (CEST, +02:00) — a Wednesday.
  const summer = '2026-07-29T20:09:07.000Z'
  // 2026-01-05 10:05:00 wall time in Bratislava (CET, +01:00) — a Monday.
  const winter = '2026-01-05T09:05:00.000Z'

  it('renders every style deterministically (summer, genitive month)', () => {
    expect(formatSk(summer, 'full', TZ)).toBe('streda 29. júla 2026 o 22:09')
    expect(formatSk(summer, 'long', TZ)).toBe('29. júla 2026 o 22:09')
    expect(formatSk(summer, 'dateTime', TZ)).toBe('29. 7. 2026, 22:09')
    expect(formatSk(summer, 'dateTimeSec', TZ)).toBe('29. 7. 2026, 22:09:07')
    expect(formatSk(summer, 'date', TZ)).toBe('29. 7. 2026')
    expect(formatSk(summer, 'time', TZ)).toBe('22:09')
    expect(formatSk(summer, 'timeSec', TZ)).toBe('22:09:07')
    expect(formatSk(summer, 'dayMonth', TZ)).toBe('29. júl')
    expect(formatSk(summer, 'monthYear', TZ)).toBe('júl 2026')
  })

  it('uses nominative month standalone and genitive in a date (winter)', () => {
    expect(formatSk(winter, 'full', TZ)).toBe(
      'pondelok 5. januára 2026 o 10:05',
    )
    expect(formatSk(winter, 'monthYear', TZ)).toBe('január 2026')
    expect(formatSk(winter, 'date', TZ)).toBe('5. 1. 2026')
  })

  it('defaults to Europe/Bratislava when timezone omitted', () => {
    expect(formatSk(summer, 'time')).toBe('22:09')
  })

  it('emits only plain ASCII spaces (no U+00A0/U+202F — the hydration-mismatch trap)', () => {
    for (const style of ['full', 'long', 'dateTime', 'monthYear'] as const) {
      expect(formatSk(summer, style, TZ)).not.toMatch(/[\u00A0\u202F]/)
    }
  })
})
