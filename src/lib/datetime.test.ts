import { describe, it, expect } from 'vitest'
import { zonedLocalToUtcIso, utcIsoToZonedLocal } from './datetime'

const TZ = 'Europe/Bratislava'

describe('zonedLocalToUtcIso', () => {
  it('converts summer (CEST, +02:00) wall time to UTC', () => {
    expect(zonedLocalToUtcIso('2026-08-01T20:00', TZ)).toBe('2026-08-01T18:00:00.000Z')
  })

  it('converts winter (CET, +01:00) wall time to UTC', () => {
    expect(zonedLocalToUtcIso('2026-01-15T20:00', TZ)).toBe('2026-01-15T19:00:00.000Z')
  })
})

describe('utcIsoToZonedLocal', () => {
  it('formats a UTC instant as local wall time (summer)', () => {
    expect(utcIsoToZonedLocal('2026-08-01T18:00:00.000Z', TZ)).toBe('2026-08-01T20:00')
  })

  it('round-trips local -> utc -> local', () => {
    const local = '2026-09-20T19:30'
    expect(utcIsoToZonedLocal(zonedLocalToUtcIso(local, TZ), TZ)).toBe(local)
  })
})
