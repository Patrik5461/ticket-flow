import { describe, it, expect } from 'vitest'
import { AUDIT_ACTION_LABEL, summarizeAuditChange } from './audit-summary'

describe('summarizeAuditChange', () => {
  it('shows what changed and drops what did not', () => {
    expect(
      summarizeAuditChange(
        { name: 'Kino B', seats: 390 },
        { name: 'Kino B Žilina', seats: 390 },
      ),
    ).toBe('názov Kino B → Kino B Žilina')
  })

  it('reads a map save the way the admin wrote it', () => {
    expect(
      summarizeAuditChange(
        { name: 'Rozloženie 789', seats: 390 },
        { name: 'Rozloženie 789', seats: 388, objects: 11 },
      ),
    ).toBe('sedadlá 390 → 388, objekty 11')
  })

  it('renders a create (no old side) as plain values', () => {
    expect(summarizeAuditChange(null, { name: 'Nová mapa', seats: 0 })).toBe(
      'názov Nová mapa, sedadlá 0',
    )
  })

  it('renders a delete (no new side) as plain values, minus the row id', () => {
    expect(
      summarizeAuditChange(
        { name: 'Stará mapa', venueId: 'a3f9-…' },
        null,
      ),
    ).toBe('názov Stará mapa')
  })

  it('spells out a lock being released', () => {
    expect(
      summarizeAuditChange(
        { importLockedAt: '2026-08-03T18:00:00Z' },
        { importLockedAt: null },
      ),
    ).toBe('zámok 2026-08-03T18:00:00Z → —')
  })

  it('falls back to the field name for anything unrecognised', () => {
    expect(summarizeAuditChange({ weird: 1 }, { weird: 2 })).toBe('weird 1 → 2')
  })

  it('truncates a long value instead of filling the screen', () => {
    const long = 'x'.repeat(200)
    const out = summarizeAuditChange({}, { address: long })
    expect(out.length).toBeLessThan(80)
    expect(out.endsWith('…')).toBe(true)
  })

  it('never throws on a row that is not an object', () => {
    expect(summarizeAuditChange(null, null)).toBe('')
    expect(summarizeAuditChange('nope', 42)).toBe('')
    expect(summarizeAuditChange([1, 2], undefined)).toBe('')
  })

  it('labels every action this module writes', () => {
    for (const action of [
      'admin.venue_update',
      'admin.venue_map_create',
      'admin.venue_map_update',
      'admin.venue_map_delete',
      'admin.venue_import_unlock',
    ]) {
      expect(AUDIT_ACTION_LABEL[action]).toBeTruthy()
    }
  })
})
