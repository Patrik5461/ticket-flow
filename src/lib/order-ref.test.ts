import { describe, it, expect } from 'vitest'
import { orderRef, refMatches, maskEmail } from './order-ref'

describe('orderRef', () => {
  it('is the first 8 chars uppercased', () => {
    expect(orderRef('abcdef12-3456-7890')).toBe('ABCDEF12')
  })
})

describe('refMatches', () => {
  const id = 'abcdef12-3456-7890-0000-000000000000'
  it('matches case-insensitively with trimming', () => {
    expect(refMatches(id, 'abcdef12')).toBe(true)
    expect(refMatches(id, '  ABCDEF12 ')).toBe(true)
  })
  it('rejects a wrong ref', () => {
    expect(refMatches(id, 'abcdef13')).toBe(false)
    expect(refMatches(id, '')).toBe(false)
  })
})

describe('maskEmail', () => {
  it('keeps up to 2 leading chars + domain', () => {
    expect(maskEmail('jana@x.sk')).toBe('ja***@x.sk')
    expect(maskEmail('a@x.sk')).toBe('a***@x.sk')
  })
  it('handles malformed input', () => {
    expect(maskEmail('nope')).toBe('***')
  })
})
