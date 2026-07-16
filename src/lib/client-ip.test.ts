import { describe, it, expect } from 'vitest'
import { clientIpFromHeaders } from './client-ip'

const h = (o: Record<string, string>) => new Headers(o)

describe('clientIpFromHeaders', () => {
  it('takes the first X-Forwarded-For entry', () => {
    expect(
      clientIpFromHeaders(h({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })),
    ).toBe('1.2.3.4')
  })
  it('falls back to X-Real-IP', () => {
    expect(clientIpFromHeaders(h({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9')
  })
  it('returns "unknown" when nothing is present', () => {
    expect(clientIpFromHeaders(h({}))).toBe('unknown')
  })
})
