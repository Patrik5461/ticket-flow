import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { EventCard } from '../components/EventCard'
import { SiteFooter, SiteNav } from '../components/SiteChrome'
import { EVENT_CATEGORIES, isEventCategory } from '../lib/event-categories'
import { EVENTS_PAGE_SIZE, normalizePage, pageCount } from '../lib/paging'
import { listEventCitiesFn, searchEventsFn } from '../server/fns'

export const Route = createFileRoute('/podujatia')({
  head: () => ({
    meta: [
      { title: 'Podujatia — Ticketio' },
      {
        name: 'description',
        content:
          'Program podujatí v predaji na Ticketiu — koncerty, festivaly, divadlo a šport. Filtrujte podľa žánru a mesta, vstupenku dostanete s QR kódom do mailu.',
      },
    ],
  }),
  // The whole filter lives in the URL so a filtered program can be linked and
  // shared, and so the header search box has somewhere to submit to.
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : '',
    kat: isEventCategory(search.kat) ? search.kat : '',
    mesto: typeof search.mesto === 'string' ? search.mesto : '',
    page: normalizePage(search.page),
  }),
  loaderDeps: ({ search }) => ({
    q: search.q,
    kat: search.kat,
    mesto: search.mesto,
    page: search.page,
  }),
  loader: async ({ deps }) => {
    const [page, cities] = await Promise.all([
      searchEventsFn({
        data: {
          q: deps.q || null,
          category: deps.kat || null,
          city: deps.mesto || null,
          page: deps.page,
          pageSize: EVENTS_PAGE_SIZE,
        },
      }),
      listEventCitiesFn(),
    ])
    return { events: page.events, total: page.total, cities }
  },
  component: EventsPage,
})

function countLabel(n: number): string {
  if (n === 1) return '1 podujatie v predaji'
  if (n < 5) return `${n} podujatia v predaji`
  return `${n} podujatí v predaji`
}

/** The shape validateSearch above guarantees — what every filter link builds. */
interface EventsSearch {
  q: string
  kat: string
  mesto: string
  page: number
}

/** Accusative, as in "program má …" — 1 stranu, 2 strany, 5 strán. */
function pagesLabel(n: number): string {
  if (n === 1) return '1 stranu'
  if (n < 5) return `${n} strany`
  return `${n} strán`
}

/**
 * Collapsible select-style filter: click opens the list, pick one value.
 *
 * Built on `<details>` with real links inside rather than a JS-toggled panel of
 * buttons. Same behaviour with scripting on, but the panel still opens without
 * it, and every filtered listing is a URL a crawler can follow — a filter that
 * only exists once React has booted is invisible to both.
 */
function FilterSelect<T extends string>({
  label,
  value,
  options,
  searchFor,
}: {
  label: string
  value: T
  options: { value: T; label: string; hint?: string | number }[]
  searchFor: (value: T) => EventsSearch
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const current = options.find((o) => o.value === value) ?? options[0]
  const close = () => {
    if (ref.current) ref.current.open = false
  }

  // A <details> stays open until it is clicked again; a picker should also
  // close when the visitor moves on to something else.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = ref.current
      if (el?.open && !el.contains(e.target as Node)) el.open = false
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <details ref={ref} className="group relative w-full sm:w-64">
      <summary
        className={`flex w-full cursor-pointer list-none items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition [&::-webkit-details-marker]:hidden ${
          value !== ''
            ? 'border-accent/60 bg-accent/10 text-accent'
            : 'border-ink-700 bg-ink-900/60 text-ink-200 hover:border-ink-500'
        }`}
      >
        <span className="truncate">
          <span className="mr-2 text-xs uppercase tracking-widest text-ink-500">
            {label}
          </span>
          {current.label}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="shrink-0 transition-transform group-open:rotate-180"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>

      <ul className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-xl border border-ink-700 bg-ink-900 p-1 shadow-2xl">
        {options.map((o) => (
          <li key={o.value || 'all'}>
            <Link
              to="/podujatia"
              search={searchFor(o.value)}
              onClick={close}
              aria-current={o.value === value ? 'true' : undefined}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                o.value === value
                  ? 'bg-accent/15 text-accent'
                  : 'text-ink-200 hover:bg-ink-800 hover:text-ink-100'
              }`}
            >
              <span className="truncate">{o.label}</span>
              {o.hint !== undefined && (
                <span className="text-xs opacity-60">{o.hint}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  )
}


function EventsPage() {
  const { events, total, cities } = Route.useLoaderData()
  const { q, kat, mesto, page } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  // Typing must not fire a request per keystroke, so the box keeps its own
  // value and pushes it into the URL once the typing stops. Any new term
  // starts back at page one — page 4 of the old result means nothing now.
  const [term, setTerm] = useState(q)
  useEffect(() => setTerm(q), [q])
  useEffect(() => {
    if (term === q) return
    const t = setTimeout(() => {
      void navigate({
        search: (s) => ({ ...s, q: term, page: 1 }),
        replace: true,
      })
    }, 350)
    return () => clearTimeout(t)
  }, [term, q, navigate])

  const filtered = q.trim().length > 0 || kat !== '' || mesto !== ''
  const pages = pageCount(total, EVENTS_PAGE_SIZE)
  const firstOnPage = (page - 1) * EVENTS_PAGE_SIZE + 1
  const lastOnPage = firstOnPage + events.length - 1

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

        {/* Search. A real GET form: with scripting the debounce below has
            already navigated, without it Enter still submits to this page. */}
        <form
          method="get"
          action="/podujatia"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            void navigate({ search: (s) => ({ ...s, q: term, page: 1 }) })
          }}
          className="relative mt-8 max-w-xl"
        >
          <input type="hidden" name="kat" value={kat} />
          <input type="hidden" name="mesto" value={mesto} />
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
            name="q"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Hľadať podujatie, miesto alebo mesto…"
            aria-label="Hľadať podujatie"
            className="w-full rounded-xl border border-ink-700 bg-ink-900/60 py-3 pl-12 pr-4 text-ink-100 placeholder:text-ink-500 focus:border-accent/60 focus:outline-none"
          />
        </form>

        {/* Genre + city — collapsible pickers, value lives in the URL. */}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <FilterSelect
            label="Žáner"
            value={kat}
            options={[
              { value: '', label: 'Všetky žánre' },
              ...EVENT_CATEGORIES.map((c) => ({
                value: c.slug,
                label: c.label,
              })),
            ]}
            searchFor={(v) => ({ q, kat: v, mesto, page: 1 })}
          />

          {cities.length > 0 && (
            <FilterSelect
              label="Mesto"
              value={mesto}
              options={[
                { value: '', label: 'Celé Slovensko' },
                ...cities.map((c) => ({
                  value: c.cityKey,
                  label: c.city,
                  hint: c.eventCount,
                })),
              ]}
              searchFor={(v) => ({ q, kat, mesto: v, page: 1 })}
            />
          )}
        </div>


        {events.length === 0 ? (
          <div className="card-surface mt-12 p-16 text-center">
            <p className="text-ink-400">
              {/* A page past the end is a typed URL or a stale link, not an
                  empty program — saying "nothing is on" there would lie. */}
              {total > 0
                ? `Strana ${page} je prázdna — program má ${pagesLabel(pages)}.`
                : filtered
                  ? 'Tomuto výberu nezodpovedá žiadne podujatie.'
                  : 'Zatiaľ nie sú zverejnené žiadne podujatia.'}
            </p>
            {total > 0 ? (
              <Link
                to="/podujatia"
                search={{ q, kat, mesto, page: 1 }}
                className="btn-ghost mt-6"
              >
                Na prvú stranu
              </Link>
            ) : filtered ? (
              <Link
                to="/podujatia"
                search={{ q: '', kat: '', mesto: '', page: 1 }}
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
              {countLabel(total)}
              {pages > 1 && (
                <>
                  {' · '}
                  {firstOnPage}–{lastOnPage} na strane {page} z {pages}
                </>
              )}
            </div>
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((e, idx) => (
                <EventCard key={e.id} event={e} index={idx} />
              ))}
            </div>

            {pages > 1 && (
              <nav
                aria-label="Stránkovanie"
                className="mt-12 flex items-center justify-center gap-2"
              >
                {page > 1 ? (
                  <Link
                    to="/podujatia"
                    search={{ q, kat, mesto, page: page - 1 }}
                    className="btn-ghost text-sm"
                    rel="prev"
                  >
                    ← Predchádzajúca
                  </Link>
                ) : (
                  <span className="btn-ghost pointer-events-none text-sm opacity-40">
                    ← Predchádzajúca
                  </span>
                )}
                <span className="px-4 text-sm text-ink-400">
                  {page} / {pages}
                </span>
                {page < pages ? (
                  <Link
                    to="/podujatia"
                    search={{ q, kat, mesto, page: page + 1 }}
                    className="btn-ghost text-sm"
                    rel="next"
                  >
                    Ďalšia →
                  </Link>
                ) : (
                  <span className="btn-ghost pointer-events-none text-sm opacity-40">
                    Ďalšia →
                  </span>
                )}
              </nav>
            )}
          </>
        )}
      </div>

      <SiteFooter />
    </div>
  )
}
