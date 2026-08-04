import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { EventCard } from '../components/EventCard'
import { SiteFooter, SiteNav } from '../components/SiteChrome'
import { EVENT_CATEGORIES, isEventCategory } from '../lib/event-categories'
import { upcomingEvents } from '../lib/events'
import { searchEventsFn } from '../server/fns'

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
  // The filter lives in the URL so a filtered program can be linked and shared,
  // and so the nav search box has somewhere to submit to.
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : '',
    kat: isEventCategory(search.kat) ? search.kat : '',
  }),
  loaderDeps: ({ search }) => ({ q: search.q, kat: search.kat }),
  // Filtered in the loader, not in the component: the same list has to come out
  // of SSR and out of hydration, and `Date.now()` differs between the two.
  loader: async ({ deps }) => {
    const events = await searchEventsFn({
      data: { q: deps.q || null, category: deps.kat || null },
    })
    return { events: upcomingEvents(events) }
  },
  component: EventsPage,
})

function countLabel(n: number): string {
  if (n === 1) return '1 podujatie v predaji'
  if (n < 5) return `${n} podujatia v predaji`
  return `${n} podujatí v predaji`
}

function EventsPage() {
  const { events } = Route.useLoaderData()
  const { q, kat } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  // Typing must not fire a request per keystroke, so the box keeps its own
  // value and pushes it into the URL once the typing stops.
  const [term, setTerm] = useState(q)
  useEffect(() => setTerm(q), [q])
  useEffect(() => {
    if (term === q) return
    const t = setTimeout(() => {
      void navigate({ search: (s) => ({ ...s, q: term }), replace: true })
    }, 350)
    return () => clearTimeout(t)
  }, [term, q, navigate])

  const filtered = q.trim().length > 0 || kat !== ''

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

        {/* Search */}
        <div className="relative mt-8 max-w-xl">
          <svg
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-500"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Hľadať podujatie alebo miesto…"
            aria-label="Hľadať podujatie"
            className="w-full rounded-xl border border-ink-700 bg-ink-900/60 py-3 pl-12 pr-4 text-ink-100 placeholder:text-ink-500 focus:border-accent/60 focus:outline-none"
          />
        </div>

        {/* Category chips */}
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to="/podujatia"
            search={{ q, kat: '' }}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${
              kat === ''
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-ink-700 text-ink-300 hover:border-ink-500 hover:text-ink-100'
            }`}
          >
            Všetko
          </Link>
          {EVENT_CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              to="/podujatia"
              search={{ q, kat: kat === c.slug ? '' : c.slug }}
              className={`rounded-full border px-4 py-1.5 text-sm transition ${
                kat === c.slug
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-ink-700 text-ink-300 hover:border-ink-500 hover:text-ink-100'
              }`}
            >
              {c.label}
            </Link>
          ))}
        </div>

        {events.length === 0 ? (
          <div className="card-surface mt-12 p-16 text-center">
            <p className="text-ink-400">
              {filtered
                ? 'Tomuto výberu nezodpovedá žiadne podujatie.'
                : 'Zatiaľ nie sú zverejnené žiadne podujatia.'}
            </p>
            {filtered ? (
              <Link
                to="/podujatia"
                search={{ q: '', kat: '' }}
                className="btn-ghost mt-6"
              >
                Zrušiť filter
              </Link>
            ) : (
              <Link to="/" className="btn-ghost mt-6">
                Späť na hlavnú stránku
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="mt-8 text-sm text-ink-500">
              {countLabel(events.length)}
            </div>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
