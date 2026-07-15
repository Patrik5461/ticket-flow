import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { getEventFn } from '../server/fns'
import { formatEur } from '../lib/money'

export const Route = createFileRoute('/e/$slug/')({
  loader: async ({ params }) => {
    const data = await getEventFn({ data: { slug: params.slug } })
    if (!data) throw notFound()
    return data
  },
  component: EventPage,
})

function formatDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: tz,
  }).format(new Date(iso))
}

function EventPage() {
  const { slug } = Route.useParams()
  const { event, ticketTypes } = Route.useLoaderData()
  const navigate = useNavigate()
  const [qty, setQty] = useState<Record<string, number>>({})

  const total = ticketTypes.reduce(
    (sum, t) => sum + (qty[t.id] ?? 0) * t.price_cents,
    0,
  )
  const anySelected = Object.values(qty).some((n) => n > 0)

  const setQuantity = (id: string, value: number, max: number) => {
    const clamped = Math.max(0, Math.min(value, max))
    setQty((prev) => ({ ...prev, [id]: clamped }))
  }

  const goToCheckout = () => {
    const items = ticketTypes
      .filter((t) => (qty[t.id] ?? 0) > 0)
      .map((t) => `${t.id}:${qty[t.id]}`)
      .join(',')
    navigate({ to: '/e/$slug/checkout', params: { slug }, search: { items } })
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <a href="/" className="text-sm text-indigo-600 hover:underline">
        ← Späť
      </a>

      <h1 className="mt-4 text-3xl font-bold">{event.title}</h1>
      <p className="mt-2 text-gray-600">{formatDate(event.starts_at, event.timezone)}</p>
      {event.venue_name && (
        <p className="text-gray-600">
          {event.venue_name}
          {event.venue_address ? `, ${event.venue_address}` : ''}
        </p>
      )}
      {event.description && (
        <p className="mt-4 whitespace-pre-line text-gray-800">{event.description}</p>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Vstupenky</h2>
        {ticketTypes.length === 0 ? (
          <p className="text-gray-500">Momentálne nie sú v predaji žiadne vstupenky.</p>
        ) : (
          <ul className="space-y-3">
            {ticketTypes.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div>
                  <div className="font-medium">{t.name}</div>
                  {t.description && (
                    <div className="text-sm text-gray-500">{t.description}</div>
                  )}
                  <div className="mt-1 text-sm font-semibold">
                    {formatEur(t.price_cents)}
                  </div>
                </div>
                {t.sold_out ? (
                  <span className="text-sm font-medium text-gray-400">Vypredané</span>
                ) : (
                  <input
                    type="number"
                    min={0}
                    max={t.max_per_order}
                    value={qty[t.id] ?? 0}
                    onChange={(e) =>
                      setQuantity(t.id, Number(e.target.value), t.max_per_order)
                    }
                    className="w-20 rounded-md border px-3 py-2 text-center"
                    aria-label={`Počet: ${t.name}`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {anySelected && (
        <div className="sticky bottom-4 mt-6 flex items-center justify-between rounded-lg border bg-white p-4 shadow-lg">
          <span className="font-semibold">Spolu {formatEur(total)}</span>
          <button
            onClick={goToCheckout}
            className="rounded-md bg-indigo-600 px-5 py-2 font-medium text-white hover:bg-indigo-700"
          >
            Pokračovať
          </button>
        </div>
      )}
    </div>
  )
}
