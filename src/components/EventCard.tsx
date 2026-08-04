import { Link } from '@tanstack/react-router'

import { formatSk } from '../lib/datetime'
import { categoryLabel } from '../lib/event-categories'

/**
 * One published event, as shown on the landing teaser and on /podujatia.
 *
 * Structural on purpose: the props are the columns `listPublishedEvents()`
 * actually selects, so the card can be fed straight from a route loader
 * without dragging server types into the client bundle.
 */
export interface EventCardEvent {
  id: string
  slug: string
  title: string
  starts_at: string
  timezone: string
  venue_name?: string | null
  cover_url?: string | null
  category?: string | null
  from_price_cents?: number | null
}

function formatDateShort(iso: string, tz: string) {
  return formatSk(iso, 'dayMonth', tz)
}

function formatTime(iso: string, tz: string) {
  return formatSk(iso, 'time', tz)
}

export function EventCard({
  event,
  index = 0,
}: {
  event: EventCardEvent
  index?: number
}) {
  const cover = event.cover_url
  const fromPrice = event.from_price_cents
  const category = categoryLabel(event.category)
  const [day, month] = formatDateShort(event.starts_at, event.timezone).split(
    ' ',
  )

  return (
    <Link
      to="/e/$slug"
      params={{ slug: event.slug }}
      className="group card-surface animate-fade-up relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-[0_20px_60px_-20px_var(--color-accent-glow)]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Cover */}
      <div
        className="relative aspect-[4/3] w-full overflow-hidden"
        style={{
          background: cover
            ? `url(${cover}) center/cover`
            : 'var(--gradient-fallback)',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-transparent" />
        <div className="absolute left-4 top-4 flex flex-col items-center justify-center rounded-xl bg-ink-950/80 px-3 py-2 backdrop-blur-md">
          <span className="font-display text-xs font-semibold uppercase text-accent">
            {month}
          </span>
          <span className="font-display text-xl font-bold leading-none">
            {day}
          </span>
        </div>
        {typeof fromPrice === 'number' && (
          <div className="absolute right-4 top-4 rounded-full bg-ink-950/80 px-3 py-1 text-xs font-medium backdrop-blur-md">
            od{' '}
            <span className="text-accent">
              {(fromPrice / 100).toFixed(0)} €
            </span>
          </div>
        )}
      </div>
      <div className="p-5">
        {category && (
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-500">
            {category}
          </div>
        )}
        <h3 className="font-display text-xl font-bold leading-tight transition-colors group-hover:text-accent">
          {event.title}
        </h3>
        <div className="mt-3 flex items-center gap-4 text-sm text-ink-400">
          <span className="inline-flex items-center gap-1.5">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            {formatTime(event.starts_at, event.timezone)}
          </span>
          {event.venue_name && (
            <span className="inline-flex items-center gap-1.5 truncate">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 22s-8-7.5-8-13a8 8 0 1 1 16 0c0 5.5-8 13-8 13z" />
                <circle cx="12" cy="9" r="3" />
              </svg>
              <span className="truncate">{event.venue_name}</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
