import { describe, it, expect } from 'vitest'
import { clientIpFromHeaders } from './client-ip'

const h = (o: Record<string, string>) => new Headers(o)

describe('clientIpFromHeaders', () => {
  it('takes the last X-Forwarded-For entry, the one our proxy appended', () => {
    expect(
      clientIpFromHeaders(h({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })),
    ).toBe('10.0.0.1')
  })

  it('ignores a value the caller prepended', () => {
    // The attack this exists to stop: everything left of what nginx appends is
    // text the caller chose, so trusting it hands out a fresh rate-limit bucket
    // on demand — and lets one caller burn somebody else's.
    const spoofed = clientIpFromHeaders(
      h({ 'x-forwarded-for': '203.0.113.7, 192.168.1.1' }),
    )
    const honest = clientIpFromHeaders(h({ 'x-forwarded-for': '192.168.1.1' }))
    expect(spoofed).toBe('192.168.1.1')
    expect(spoofed).toBe(honest)
  })

  it('cannot be moved by adding more hops', () => {
    expect(
      clientIpFromHeaders(
        h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3, 192.168.1.1' }),
      ),
    ).toBe('192.168.1.1')
  })

  it('skips loopback and keeps the real hop', () => {
    expect(
      clientIpFromHeaders(h({ 'x-forwarded-for': '198.51.100.9, 127.0.0.1' })),
    ).toBe('198.51.100.9')
  })

  it('handles a single entry', () => {
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '192.168.1.1' }))).toBe(
      '192.168.1.1',
    )
  })

  it('falls back to X-Real-IP', () => {
    expect(clientIpFromHeaders(h({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9')
  })

  it('falls back to X-Real-IP when the header is only loopback', () => {
    expect(
      clientIpFromHeaders(
        h({ 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '9.9.9.9' }),
      ),
    ).toBe('9.9.9.9')
  })

  it('returns "unknown" when nothing is present', () => {
    expect(clientIpFromHeaders(h({}))).toBe('unknown')
  })
})
