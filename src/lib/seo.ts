/**
 * Pure SEO builders — schema.org/Event JSON-LD and meta-tag lists for the event
 * page. No DB/IO; callers pass already-loaded data + absolute URLs.
 */

export interface SeoEvent {
  title: string
  slug: string
  description: string | null
  venue_name: string | null
  venue_address: string | null
  starts_at: string
  ends_at: string | null
  cover_url: string | null
}

export interface SeoTicketType {
  price_cents: number
  currency: string
  sold_out: boolean
}

/** Trim + collapse to a plain-text meta description of at most `max` chars. */
export function metaDescription(
  event: SeoEvent,
  whenLabel: string,
  max = 160,
): string {
  const base =
    (event.description && event.description.trim()) ||
    `${event.title}${event.venue_name ? ` — ${event.venue_name}` : ''}, ${whenLabel}. Kúpte si vstupenky online cez Ticketio.`
  const flat = base.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/** schema.org/Event JSON-LD object (stringify into a ld+json script). */
export function eventJsonLd(input: {
  event: SeoEvent
  ticketTypes: SeoTicketType[]
  pageUrl: string
  imageUrl: string
}): Record<string, unknown> {
  const { event, ticketTypes, pageUrl, imageUrl } = input

  const priced = ticketTypes.filter((t) => Number.isFinite(t.price_cents))
  const lowest =
    priced.length > 0
      ? priced.reduce((min, t) => (t.price_cents < min.price_cents ? t : min))
      : null
  const anyAvailable = ticketTypes.some((t) => !t.sold_out)

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    startDate: event.starts_at,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    url: pageUrl,
    image: [imageUrl],
  }
  if (event.ends_at) jsonLd.endDate = event.ends_at
  if (event.description) jsonLd.description = event.description.trim()
  if (event.venue_name) {
    jsonLd.location = {
      '@type': 'Place',
      name: event.venue_name,
      ...(event.venue_address ? { address: event.venue_address } : {}),
    }
  }
  if (lowest) {
    jsonLd.offers = {
      '@type': 'Offer',
      url: pageUrl,
      price: (lowest.price_cents / 100).toFixed(2),
      priceCurrency: lowest.currency || 'EUR',
      availability: anyAvailable
        ? 'https://schema.org/InStock'
        : 'https://schema.org/SoldOut',
    }
  }
  return jsonLd
}
