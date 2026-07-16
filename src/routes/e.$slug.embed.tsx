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
      className="mx-auto max-w-md p-4"
      style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#f4f4f5',
      }}
    >
      <div
        className="rounded-2xl border p-5"
        style={{
          background: 'linear-gradient(135deg, #1a1a20 0%, #101014 100%)',
          borderColor: '#26262e',
          boxShadow: '0 10px 40px -12px rgba(74, 222, 128, 0.25)',
        }}
      >
        <h1
          className="text-lg font-bold tracking-tight"
          style={{ fontFamily: 'Space Grotesk, system-ui, sans-serif' }}
        >
          {event.title}
        </h1>
        <p className="mt-1 text-xs" style={{ color: '#a1a1aa' }}>
          {when}
          {event.venue_name ? ` · ${event.venue_name}` : ''}
        </p>

        <div className="mt-4 space-y-2.5">
          {ticketTypes.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-xl border p-3"
              style={{ borderColor: '#26262e', background: 'rgba(9,9,11,0.4)' }}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{t.name}</div>
                <div
                  className="mt-0.5 text-xs font-medium"
                  style={{ color: t.sold_out ? '#a1a1aa' : '#4ade80' }}
                >
                  {t.sold_out ? 'Vypredané' : formatEur(t.price_cents)}
                </div>
              </div>
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={(qty[t.id] ?? 0) <= 0}
                  onClick={() =>
                    setQty((q) => ({ ...q, [t.id]: Math.max(0, (q[t.id] ?? 0) - 1) }))
                  }
                  className="h-8 w-8 rounded-md border text-base disabled:opacity-30"
                  style={{ borderColor: '#3a3a44', background: '#0c0c0f', color: '#f4f4f5' }}
                  aria-label="Menej"
                >
                  −
                </button>
                <span className="w-6 text-center tabular-nums font-semibold">
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
                  className="h-8 w-8 rounded-md border text-base disabled:opacity-30"
                  style={{ borderColor: '#3a3a44', background: '#0c0c0f', color: '#f4f4f5' }}
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
          className="mt-5 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40"
          style={{
            background: '#4ade80',
            color: '#09090b',
            boxShadow: '0 10px 30px -12px rgba(74, 222, 128, 0.5)',
          }}
        >
          {count === 0
            ? 'Vyberte vstupenky'
            : `Kúpiť (${formatEur(total)})`}
        </button>
        <p className="mt-3 text-center text-[11px]" style={{ color: '#6b6b76' }}>
          Zabezpečuje Ticketio
        </p>
      </div>
    </div>
  )
}
