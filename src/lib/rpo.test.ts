import { describe, it, expect } from 'vitest'
import { normalizeIco, companyFromRpoResult } from './rpo'

describe('normalizeIco', () => {
  it('accepts 6–8 digit IČO, stripping spaces', () => {
    expect(normalizeIco('35 697 270')).toBe('35697270')
    expect(normalizeIco('123456')).toBe('123456')
  })
  it('rejects non-numeric or wrong-length input', () => {
    expect(normalizeIco('12345')).toBeNull()
    expect(normalizeIco('123456789')).toBeNull()
    expect(normalizeIco('SK123456')).toBeNull()
    expect(normalizeIco('')).toBeNull()
  })
})

describe('companyFromRpoResult', () => {
  // Trimmed real shape from api.statistics.sk (IČO 35697270 → Orange).
  const orange = {
    fullNames: [
      {
        value: 'GLOBTEL GSM a.s.',
        validFrom: '1996-12-20',
        validTo: '1997-10-23',
      },
      {
        value: 'Globtel, a.s.',
        validFrom: '2000-08-30',
        validTo: '2002-03-07',
      },
      { value: 'Orange Slovensko, a.s.', validFrom: '2002-03-08' }, // current (no validTo)
    ],
    addresses: [
      {
        validFrom: '1997-03-12',
        validTo: '1999-10-12',
        street: 'Plynárenská',
        buildingNumber: '1',
        postalCodes: ['82109'],
        municipality: { value: 'Bratislava' },
      },
      {
        validFrom: '2012-08-01',
        street: 'Metodova',
        buildingNumber: '8',
        postalCodes: ['82108'],
        municipality: { value: 'Bratislava' },
      },
    ],
  }

  it('picks the currently valid name and formats the current address', () => {
    expect(companyFromRpoResult(orange)).toEqual({
      name: 'Orange Slovensko, a.s.',
      address: 'Metodova 8, 82108 Bratislava',
    })
  })

  it('falls back to the latest validFrom when every entry has a validTo', () => {
    const closed = {
      fullNames: [
        {
          value: 'Stará, s.r.o.',
          validFrom: '2001-01-01',
          validTo: '2010-01-01',
        },
        {
          value: 'Novšia, s.r.o.',
          validFrom: '2010-01-02',
          validTo: '2020-01-01',
        },
      ],
    }
    expect(companyFromRpoResult(closed)?.name).toBe('Novšia, s.r.o.')
  })

  it('returns null when there is no entity or no name', () => {
    expect(companyFromRpoResult(undefined)).toBeNull()
    expect(companyFromRpoResult({ addresses: [] })).toBeNull()
  })
})
