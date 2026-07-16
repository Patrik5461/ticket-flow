import { describe, it, expect } from 'vitest'
import {
  signWebhookBody,
  signatureHeader,
  isWebhookEventType,
  generateWebhookSecret,
} from './webhooks'

describe('webhook signing', () => {
  it('is deterministic and sensitive to body/timestamp/secret', () => {
    const a = signWebhookBody('sec', '100', '{"x":1}')
    expect(a).toBe(signWebhookBody('sec', '100', '{"x":1}'))
    expect(a).not.toBe(signWebhookBody('sec', '101', '{"x":1}'))
    expect(a).not.toBe(signWebhookBody('sec', '100', '{"x":2}'))
    expect(a).not.toBe(signWebhookBody('other', '100', '{"x":1}'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('formats the header as t=..,v1=..', () => {
    const h = signatureHeader('sec', '100', 'body')
    expect(h).toBe(`t=100,v1=${signWebhookBody('sec', '100', 'body')}`)
  })
})

describe('event types', () => {
  it('recognises known types only', () => {
    expect(isWebhookEventType('order.paid')).toBe(true)
    expect(isWebhookEventType('ticket.checked_in')).toBe(true)
    expect(isWebhookEventType('order.refunded')).toBe(false)
  })
})

describe('generateWebhookSecret', () => {
  it('is prefixed and unique', () => {
    const s = generateWebhookSecret()
    expect(s.startsWith('whsec_')).toBe(true)
    expect(s).not.toBe(generateWebhookSecret())
  })
})
