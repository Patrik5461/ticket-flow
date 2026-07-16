import { createFileRoute, notFound } from '@tanstack/react-router'
import { useLayoutEffect, useRef, useState } from 'react'
import { getEventFn } from '../server/fns'
import { formatEur } from '../lib/money'

/**
 * Embeddable storefront for one event — a light, chrome-free version of the event
 * page for iframing on the organizer's site (see public/widget.js). Buying opens
 * the full checkout on our domain in a new tab (payment redirects can't run in an
 * iframe). Posts its height to the parent for auto-resize.
 *
 * Framing: this route must stay embeddable cross-origin — any future CSP must keep
 * `frame-ancestors` permissive for the embed route (do NOT send X-Frame-Options).
 */
export const Route = createFileRoute('/e/$slug/embed')({
  loader: async ({ params }) => {
    const data = await getEventFn({ data: { slug: params.slug } })
    if (!data) throw notFound()
    return data
  },
  component: EmbedPage,
})

function EmbedPage() {
  const { slug } = Route.useParams()
  const { event, ticketTypes } = Route.useLoaderData()
  const [qty, setQty] = useState<Record<string, number>>({})
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Report height to the parent frame for auto-resize.
  useLayoutEffect(() => {
    const post = () => {
      const height = document.documentElement.scrollHeight
      window.parent.postMessage({ type: 'ticketio-embed-resize', height }, '*')
    }
    post()
    const ro = new ResizeObserver(post)
    if (rootRef.current) ro.observe(rootRef.current)
    return () => ro.disconnect()
  }, [qty])

  const when = new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: event.timezone,
  }).format(new Date(event.starts_at))

  const total = ticketTypes.reduce(
    (s, t) => s + (qty[t.id] ?? 0) * t.price_cents,
    0,
  )
  const count = ticketTypes.reduce((s, t) => s + (qty[t.id] ?? 0), 0)

  const buy = () => {
    const items = ticketTypes
      .filter((t) => (qty[t.id] ?? 0) > 0)
      .map((t) => `${t.id}:${qty[t.id]}`)
      .join(',')
    if (!items) return
    window.open(
      `/e/${encodeURIComponent(slug)}/checkout?items=${encodeURIComponent(items)}`,
      '_blank',
      'noopener',
    )
  }

  return (
    <div
      ref={rootRef}
      style={{ fontFamily: 'system-ui, sans-serif' }}
      className="mx-auto max-w-md p-4 text-gray-900"
    >
      <div className="rounded-xl border border-gray-200 p-4">
        <h1 className="text-lg font-bold">{event.title}</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {when}
          {event.venue_name ? ` · ${event.venue_name}` : ''}
        </p>

        <div className="mt-4 space-y-3">
          {ticketTypes.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-gray-500">
                  {t.sold_out ? 'Vypredané' : formatEur(t.price_cents)}
                </div>
              </div>
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  disabled={(qty[t.id] ?? 0) <= 0}
                  onClick={() =>
                    setQty((q) => ({ ...q, [t.id]: Math.max(0, (q[t.id] ?? 0) - 1) }))
                  }
                  className="h-8 w-8 rounded-md border border-gray-300 disabled:opacity-30"
                  aria-label="Menej"
                >
                  −
                </button>
                <span className="w-6 text-center tabular-nums">
                  {qty[t.id] ?? 0}
                </span>
                <button
                  type="button"
                  disabled={t.sold_out || (qty[t.id] ?? 0) >= t.max_per_order}
                  onClick={() =>
                    setQty((q) => ({
                      ...q,
                      [t.id]: Math.min(t.max_per_order, (q[t.id] ?? 0) + 1),
                    }))
                  }
                  className="h-8 w-8 rounded-md border border-gray-300 disabled:opacity-30"
                  aria-label="Viac"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={buy}
          disabled={count === 0}
          className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {count === 0
            ? 'Vyberte vstupenky'
            : `Kúpiť (${formatEur(total)})`}
        </button>
        <p className="mt-2 text-center text-[11px] text-gray-400">
          Zabezpečuje Ticketio
        </p>
      </div>
    </div>
  )
}
