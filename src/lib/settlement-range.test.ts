import { describe, it, expect } from 'vitest'
import { validateSettlementRange, nextDay } from './settlement-range'

describe('validateSettlementRange', () => {
  it('accepts a valid period', () => {
    expect(
      validateSettlementRange({ from: '2026-01-01', to: '2026-01-31' }),
    ).toBeNull()
  })
  it('accepts an event without a period', () => {
    expect(validateSettlementRange({ eventId: 'e1' })).toBeNull()
  })
  it('requires a period or an event', () => {
    expect(validateSettlementRange({})).not.toBeNull()
  })
  it('rejects from after to', () => {
    expect(
      validateSettlementRange({ from: '2026-02-01', to: '2026-01-01' }),
    ).not.toBeNull()
  })
  it('accepts from == to (single day)', () => {
    expect(
      validateSettlementRange({ from: '2026-01-15', to: '2026-01-15' }),
    ).toBeNull()
  })
  it('rejects malformed dates', () => {
    expect(
      validateSettlementRange({ from: '2026/01/01', to: '2026-01-31' }),
    ).not.toBeNull()
  })
})

describe('nextDay', () => {
  it('advances one day, crossing month/year boundaries', () => {
    expect(nextDay('2026-01-15')).toBe('2026-01-16')
    expect(nextDay('2026-01-31')).toBe('2026-02-01')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })
})
