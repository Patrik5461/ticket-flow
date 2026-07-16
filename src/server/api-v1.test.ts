import { describe, it, expect } from 'vitest'
import {
  parseListParams,
  serializeEvent,
  serializeOrder,
  serializeTicket,
  serializeTicketType,
} from './api-v1'

const sp = (q: string) => new URLSearchParams(q)

describe('parseListParams', () => {
  it('defaults limit=50 offset=0', () => {
    expect(parseListParams(sp(''))).toEqual({ limit: 50, offset: 0 })
  })
  it('clamps limit to 100 and floors', () => {
    expect(parseListParams(sp('limit=500')).limit).toBe(100)
    expect(parseListParams(sp('limit=12.9')).limit).toBe(12)
  })
  it('ignores invalid/negative values', () => {
    expect(parseListParams(sp('limit=-5&offset=-2'))).toEqual({
      limit: 50,
      offset: 0,
    })
    expect(parseListParams(sp('limit=abc'))).toEqual({ limit: 50, offset: 0 })
  })
  it('reads a valid offset', () => {
    expect(parseListParams(sp('offset=20')).offset).toBe(20)
  })
})

describe('serializers', () => {
  it('event exposes only public fields', () => {
    const out = serializeEvent({
      id: 'e1',
      slug: 's',
      title: 'T',
      status: 'published',
      starts_at: 'x',
      timezone: 'Europe/Bratislava',
      qr_secret: 'SECRET',
    })
    expect(out).not.toHaveProperty('qr_secret')
    expect(out.ends_at).toBeNull()
    expect(out.venue_name).toBeNull()
  })

  it('order derives an 8-char ref and fixes EUR', () => {
    const out = serializeOrder({
      id: 'abcdef1234',
      event_id: 'e1',
      status: 'paid',
      buyer_email: 'a@b.sk',
      subtotal_cents: 1000,
      discount_cents: 0,
      total_cents: 1000,
      created_at: 't',
    })
    expect(out.ref).toBe('ABCDEF12')
    expect(out.currency).toBe('EUR')
  })

  it('ticket maps used status to checked_in', () => {
    expect(
      serializeTicket({ id: 'x', status: 'used', used_at: 't' }).checked_in,
    ).toBe(true)
    expect(
      serializeTicket({ id: 'x', status: 'valid', used_at: null }).checked_in,
    ).toBe(false)
  })

  it('ticket type coerces hidden to boolean', () => {
    expect(serializeTicketType({ id: 't', hidden: null }).hidden).toBe(false)
    expect(serializeTicketType({ id: 't', hidden: true }).hidden).toBe(true)
  })
})
