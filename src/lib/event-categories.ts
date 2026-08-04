/**
 * Event categories (genres) offered to organisers and used as the public filter.
 *
 * Kept as a plain list rather than a table: the set changes about as often as
 * the UI copy does, and a lookup table would buy a join on every public read.
 * The DB mirrors these slugs in the `events_category_check` constraint — adding
 * one here means a migration too (see 20260804150000_event_category.sql).
 */
export const EVENT_CATEGORIES = [
  { slug: 'koncert', label: 'Koncert' },
  { slug: 'festival', label: 'Festival' },
  { slug: 'divadlo', label: 'Divadlo' },
  { slug: 'sport', label: 'Šport' },
  { slug: 'konferencia', label: 'Konferencia' },
  { slug: 'party', label: 'Párty' },
  { slug: 'film', label: 'Film' },
  { slug: 'vystava', label: 'Výstava' },
  { slug: 'pre-deti', label: 'Pre deti' },
  { slug: 'workshop', label: 'Workshop / kurz' },
  { slug: 'ine', label: 'Iné' },
] as const

export type EventCategory = (typeof EVENT_CATEGORIES)[number]['slug']

const BY_SLUG = new Map<string, string>(
  EVENT_CATEGORIES.map((c) => [c.slug, c.label]),
)

export function isEventCategory(v: unknown): v is EventCategory {
  return typeof v === 'string' && BY_SLUG.has(v)
}

/** Human label for a stored slug; unknown or missing values render as nothing. */
export function categoryLabel(slug: string | null | undefined): string | null {
  return (slug && BY_SLUG.get(slug)) ?? null
}
