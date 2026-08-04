import { createFileRoute, Link } from '@tanstack/react-router'

import { EventCard } from '../components/EventCard'
import { SiteFooter, SiteNav } from '../components/SiteChrome'
import { upcomingEvents } from '../lib/events'
import { listEventsFn } from '../server/fns'

export const Route = createFileRoute('/podujatia')({
  head: () => ({
    meta: [
      { title: 'Podujatia — Ticketio' },
      {
        name: 'description',
        content:
          'Program podujatí v predaji na Ticketiu — koncerty, festivaly, divadlo a šport. Vstupenky s QR kódom priamo do mailu.',
      },
    ],
  }),
  // Filtered in the loader, not in the component: the same list has to come out
  // of SSR and out of hydration, and `Date.now()` differs between the two.
  loader: async () => {
    const events = await listEventsFn()
    return { events: upcomingEvents(events) }
  },
  component: EventsPage,
})

function EventsPage() {
  const { events } = Route.useLoaderData()

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <SiteNav />

      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="text-sm font-medium uppercase tracking-widest text-accent">
          Program
        </div>
        <h1 className="mt-2 font-display text-4xl font-bold md:text-5xl">
          Podujatia
        </h1>
        <p className="mt-4 max-w-2xl text-ink-300">
          Všetko, čo je práve v predaji. Vstupenku dostanete s QR kódom hneď po
          zaplatení priamo do mailu.
        </p>

        {events.length === 0 ? (
          <div className="card-surface mt-12 p-16 text-center">
            <p className="text-ink-400">
              Zatiaľ nie sú zverejnené žiadne podujatia.
            </p>
            <Link to="/" className="btn-ghost mt-6">
              Späť na hlavnú stránku
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-4 text-sm text-ink-500">
              {events.length}{' '}
              {events.length === 1
                ? 'podujatie'
                : events.length < 5
                  ? 'podujatia'
                  : 'podujatí'}{' '}
              v predaji
            </div>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((e, idx) => (
                <EventCard key={e.id} event={e} index={idx} />
              ))}
            </div>
          </>
        )}
      </div>

      <SiteFooter />
    </div>
  )
}
