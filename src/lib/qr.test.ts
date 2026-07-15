import { describe, it, expect } from 'vitest'
import { signTicket, verifyTicket } from './qr'
import { signOrderToken, verifyOrderToken } from './order-token'

const SECRET = '11111111-2222-3333-4444-555555555555'
const OTHER_SECRET = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const TICKET_ID = '7f2b1c9e-0000-4a10-8b3c-abcdef012345'

describe('ticket QR signing', () => {
  it('produces the TIK.{id}.{sig} format', () => {
    const token = signTicket(TICKET_ID, SECRET)
    const parts = token.split('.')
    expect(parts[0]).toBe('TIK')
    expect(parts[1]).toBe(TICKET_ID)
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/) // base64url
  })

  it('is deterministic for the same id + secret', () => {
    expect(signTicket(TICKET_ID, SECRET)).toBe(signTicket(TICKET_ID, SECRET))
  })

  it('verifies a valid token and returns the ticket id', () => {
    const token = signTicket(TICKET_ID, SECRET)
    expect(verifyTicket(token, SECRET)).toBe(TICKET_ID)
  })

  it('rejects a token signed with a different event secret', () => {
    const token = signTicket(TICKET_ID, SECRET)
    expect(verifyTicket(token, OTHER_SECRET)).toBeNull()
  })

  it('rejects a tampered ticket id', () => {
    const token = signTicket(TICKET_ID, SECRET)
    const tampered = token.replace(TICKET_ID, TICKET_ID.replace('7f2b', '0000'))
    expect(verifyTicket(tampered, SECRET)).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifyTicket('nonsense', SECRET)).toBeNull()
    expect(verifyTicket('TIK.only-two', SECRET)).toBeNull()
    expect(verifyTicket('WRONG.id.sig', SECRET)).toBeNull()
  })
})

describe('order access token', () => {
  const ORDER_ID = '99999999-0000-4a10-8b3c-abcdef012345'

  it('round-trips for the same order + secret', () => {
    const t = signOrderToken(ORDER_ID, SECRET)
    expect(verifyOrderToken(ORDER_ID, t, SECRET)).toBe(true)
  })

  it('fails for a different order id', () => {
    const t = signOrderToken(ORDER_ID, SECRET)
    expect(verifyOrderToken(TICKET_ID, t, SECRET)).toBe(false)
  })

  it('fails for a different secret', () => {
    const t = signOrderToken(ORDER_ID, SECRET)
    expect(verifyOrderToken(ORDER_ID, t, OTHER_SECRET)).toBe(false)
  })
})
