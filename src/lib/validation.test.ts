import { describe, it, expect } from 'vitest'
import { isValidIco, isValidIban, normalizeIban } from './validation'

describe('isValidIco', () => {
  it('accepts exactly 8 digits', () => {
    expect(isValidIco('12345678')).toBe(true)
    expect(isValidIco('  12345678 ')).toBe(true)
  })
  it('rejects wrong length or non-digits', () => {
    expect(isValidIco('1234567')).toBe(false)
    expect(isValidIco('123456789')).toBe(false)
    expect(isValidIco('1234567a')).toBe(false)
  })
})

describe('isValidIban', () => {
  it('accepts valid IBANs (SK/DE) with or without spaces', () => {
    expect(isValidIban('SK31 1200 0000 1987 4263 7541')).toBe(true)
    expect(isValidIban('SK3112000000198742637541')).toBe(true)
    expect(isValidIban('DE89370400440532013000')).toBe(true)
  })
  it('rejects bad checksum or format', () => {
    expect(isValidIban('SK3112000000198742637542')).toBe(false) // checksum
    expect(isValidIban('XX00')).toBe(false)
    expect(isValidIban('not-an-iban')).toBe(false)
  })
})

describe('normalizeIban', () => {
  it('strips spaces and uppercases', () => {
    expect(normalizeIban('sk31 1200 0000')).toBe(
      'SK311200 0000'.replace(/ /g, ''),
    )
  })
})
