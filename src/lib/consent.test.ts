import { describe, it, expect } from 'vitest'
import { parseConsent } from './consent'

describe('parseConsent', () => {
  it('reads a valid stored state', () => {
    expect(
      parseConsent('{"analytics":true,"marketing":false,"ts":123}', null),
    ).toEqual({ analytics: true, marketing: false, ts: 123 })
  })

  it('migrates legacy granted/denied', () => {
    expect(parseConsent(null, 'granted')).toEqual({
      analytics: true,
      marketing: true,
      ts: 0,
    })
    expect(parseConsent(null, 'denied')).toEqual({
      analytics: false,
      marketing: false,
      ts: 0,
    })
  })

  it('returns null when nothing is stored or JSON is malformed', () => {
    expect(parseConsent(null, null)).toBeNull()
    expect(parseConsent('not json', null)).toBeNull()
    expect(parseConsent('{"analytics":true}', null)).toBeNull()
  })

  it('prefers the v2 state over the legacy flag', () => {
    expect(
      parseConsent('{"analytics":false,"marketing":false,"ts":1}', 'granted'),
    ).toEqual({ analytics: false, marketing: false, ts: 1 })
  })
})
