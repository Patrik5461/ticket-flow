import { describe, it, expect } from 'vitest'
import { canRequestFrom, canDecide, decisionPatch } from './nonprofit-rules'
import { isValidIco, normalizeIco, legalFormLabel } from '../lib/nonprofit'

const OFFER = { percent: 2, minCents: 20 }
const DECIDED_AT = '2026-07-31T12:00:00.000Z'
const ADMIN = 'admin-1'

describe('canRequestFrom', () => {
  it('lets a fresh organizer apply', () => {
    expect(canRequestFrom('none').ok).toBe(true)
    expect(canRequestFrom(undefined).ok).toBe(true)
  })

  it('lets a rejected applicant fix the data and re-apply', () => {
    expect(canRequestFrom('rejected').ok).toBe(true)
  })

  it('refuses a second application while one is open', () => {
    const res = canRequestFrom('pending')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/čaká/i)
  })

  it('refuses re-applying once approved', () => {
    expect(canRequestFrom('approved').ok).toBe(false)
  })
})

describe('canDecide', () => {
  it('only an open request can be decided', () => {
    expect(canDecide('pending').ok).toBe(true)
    for (const s of ['none', 'approved', 'rejected'] as const) {
      expect(canDecide(s).ok).toBe(false)
    }
  })
})

describe('decisionPatch', () => {
  it('approval writes the offered rate onto the fee columns', () => {
    const patch = decisionPatch({
      approve: true,
      adminId: ADMIN,
      decidedAt: DECIDED_AT,
      offer: OFFER,
    })
    expect(patch).toMatchObject({
      nonprofit_status: 'approved',
      nonprofit_decided_at: DECIDED_AT,
      nonprofit_decided_by: ADMIN,
      fee_percent: 2,
      fee_min_cents: 20,
    })
  })

  it('rejection never touches the commission', () => {
    const patch = decisionPatch({
      approve: false,
      adminId: ADMIN,
      decidedAt: DECIDED_AT,
      offer: OFFER,
      reason: 'IČO nesedí s registrom.',
    })
    // The absence of these keys is the whole point — a rejected organizer must
    // keep whatever rate they had.
    expect(patch).not.toHaveProperty('fee_percent')
    expect(patch).not.toHaveProperty('fee_min_cents')
    expect(patch).toMatchObject({
      nonprofit_status: 'rejected',
      nonprofit_note: 'IČO nesedí s registrom.',
    })
  })

  it('rejection without a reason stores null rather than leaving the old note', () => {
    const patch = decisionPatch({
      approve: false,
      adminId: ADMIN,
      decidedAt: DECIDED_AT,
      offer: OFFER,
    })
    expect(patch.nonprofit_note).toBeNull()
  })

  it('carries whatever rate the platform offers at decision time', () => {
    const patch = decisionPatch({
      approve: true,
      adminId: ADMIN,
      decidedAt: DECIDED_AT,
      offer: { percent: 1.5, minCents: 0 },
    })
    expect(patch).toMatchObject({ fee_percent: 1.5, fee_min_cents: 0 })
  })
})

describe('IČO', () => {
  it('accepts 8 digits, with or without spaces', () => {
    expect(isValidIco('12345678')).toBe(true)
    expect(isValidIco(' 123 456 78 ')).toBe(true)
    expect(normalizeIco(' 123 456 78 ')).toBe('12345678')
  })

  it('rejects anything else', () => {
    for (const bad of ['1234567', '123456789', 'abcdefgh', '', '1234-5678']) {
      expect(isValidIco(bad)).toBe(false)
    }
  })
})

describe('legalFormLabel', () => {
  it('maps stored values to Slovak labels', () => {
    expect(legalFormLabel('civic_association')).toBe('Občianske združenie')
    expect(legalFormLabel('npo')).toBe('Nezisková organizácia (n. o.)')
  })

  it('is null for an unknown or missing value', () => {
    expect(legalFormLabel(null)).toBeNull()
    expect(legalFormLabel('sro')).toBeNull()
  })
})
