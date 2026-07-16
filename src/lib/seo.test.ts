import { describe, it, expect } from 'vitest'
import { eventJsonLd, metaDescription } from './seo'
import type { SeoEvent, SeoTicketType } from './seo'

const event: SeoEvent = {
  title: 'Letný Festival',
  slug: 'letny-festival',
  description: '  Najväčší open-air festival leta.  ',
  venue_name: 'Amfiteáter',
  venue_address: 'Košice',
  starts_at: '2026-08-01T18:00:00.000Z',
  ends_at: '2026-08-01T23:00:00.000Z',
  cover_url: 'https://cdn/x.jpg',
}

const types: SeoTicketType[] = [
  { price_cents: 3500, currency: 'EUR', sold_out: false },
  { price_cents: 1500, currency: 'EUR', sold_out: true },
]

describe('metaDescription', () => {
  it('uses the event description, flattened', () => {
    expect(metaDescription(event, '1. 8. 2026')).toBe(
      'Najväčší open-air festival leta.',
    )
  })
  it('falls back to a generated description and truncates', () => {
    const d = metaDescription(
      { ...event, description: null },
      '1. 8. 2026 20:00',
      40,
    )
    expect(d.length).toBeLessThanOrEqual(40)
    expect(d).toContain('Letný Festival')
  })
})

describe('eventJsonLd', () => {
  const ld = eventJsonLd({
    event,
    ticketTypes: types,
    pageUrl: 'https://ticketio.sk/e/letny-festival',
    imageUrl: 'https://cdn/x.jpg',
  })

  it('emits a valid Event with location, dates and image', () => {
    expect(ld['@type']).toBe('Event')
    expect(ld.startDate).toBe('2026-08-01T18:00:00.000Z')
    expect(ld.endDate).toBe('2026-08-01T23:00:00.000Z')
    expect((ld.location as any).name).toBe('Amfiteáter')
    expect(ld.image).toEqual(['https://cdn/x.jpg'])
  })

  it('offers the lowest price and InStock when any type is available', () => {
    const offer = ld.offers as any
    expect(offer.price).toBe('15.00')
    expect(offer.priceCurrency).toBe('EUR')
    expect(offer.availability).toBe('https://schema.org/InStock')
  })

  it('marks SoldOut when every type is sold out', () => {
    const sold = eventJsonLd({
      event,
      ticketTypes: [{ price_cents: 1500, currency: 'EUR', sold_out: true }],
      pageUrl: 'u',
      imageUrl: 'i',
    })
    expect((sold.offers as any).availability).toBe('https://schema.org/SoldOut')
  })

  it('omits offers when there are no ticket types', () => {
    const none = eventJsonLd({
      event,
      ticketTypes: [],
      pageUrl: 'u',
      imageUrl: 'i',
    })
    expect(none.offers).toBeUndefined()
  })
})
