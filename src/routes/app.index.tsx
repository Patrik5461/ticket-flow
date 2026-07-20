import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { listMyEventsFn, getOrganizerOverviewFn } from '../server/dashboard'
import type { MyEventSummary, OrganizerOverview } from '../server/dashboard'
import type { EventStatus } from '../lib/db-types'
import { formatEur } from '../lib/money'
import { formatSk } from '../lib/datetime'

export const Route = createFileRoute('/app/')({
  loader: async () => ({
    events: await listMyEventsFn(),
    overview: await getOrganizerOverviewFn({ data: { period: '30d' } }),
  }),
  component: Dashboard,
})

type Period = '30d' | 'all'

function MetricsRow({ initial }: { initial: OrganizerOverview }) {
  const [period, setPeriod] = useState<Period>('30d')
  const [data, setData] = useState<OrganizerOverview>(initial)
  const [busy, setBusy] = useState(false)

  const switchPeriod = async (p: Period) => {
    if (p === period) return
    setPeriod(p)
    setBusy(true)
    try {
      setData(await getOrganizerOverviewFn({ data: { period: p } }))
    } finally {
      setBusy(false)
    }
  }

  const cards: { label: string; value: string }[] = [
    { label: 'Predané vstupenky', value: String(data.soldTickets) },
    { label: 'Hrubé tržby', value: formatEur(data.grossCents) },
    { label: 'Provízia platformy', value: formatEur(data.feeCents) },
    { label: 'Netto na vyplatenie', value: formatEur(data.netCents) },
  ]

  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-300">Prehľad</h2>
        <div className="inline-flex overflow-hidden rounded-lg border border-ink-700 text-xs">
          {(['30d', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => switchPeriod(p)}
              className={`px-3 py-1.5 transition ${
                period === p
                  ? 'bg-ink-800 text-ink-100'
                  : 'text-ink-400 hover:text-ink-200'
              }`}
            >
              {p === '30d' ? '30 dní' : 'Celkovo'}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${busy ? 'opacity-60' : ''}`}
      >
        {cards.map((c) => (
          <div key={c.label} className="card-surface p-4">
            <div className="text-xs text-ink-400">{c.label}</div>
            <div className="mt-1 font-display text-2xl font-bold tabular-nums">
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const STATUS: Record<
  EventStatus,
  { label: string; dot: string; text: string; bg: string }
> = {
  draft: {
    label: 'Koncept',
    dot: '#6b6b76',
    text: 'var(--color-ink-300)',
    bg: 'var(--color-ink-800)',
  },
  published: {
    label: 'Zverejnené',
    dot: 'var(--color-accent)',
    text: 'var(--color-accent)',
    bg: 'color-mix(in oklab, var(--color-accent) 12%, transparent)',
  },
  ended: {
    label: 'Ukončené',
    dot: '#6b6b76',
    text: 'var(--color-ink-400)',
    bg: 'var(--color-ink-800)',
  },
  cancelled: {
    label: 'Zrušené',
    dot: '#ef4444',
    text: '#fca5a5',
    bg: 'rgba(239, 68, 68, 0.12)',
  },
}

function fmtDate(iso: string, tz: string) {
  return formatSk(iso, 'dateTime', tz)
}

function Dashboard() {
  const { events, overview } = Route.useLoaderData()

  return (
    <div className="animate-fade-up">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Moje podujatia
          </h1>
          <p className="mt-1 text-sm text-ink-400">
            Prehľad všetkých vašich eventov a ich stavu predaja.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/app/settlements" className="btn-ghost text-sm">
            Vyúčtovania
          </Link>
          <Link to="/app/events/new" className="btn-primary text-sm">
            <span className="text-base leading-none">+</span> Nové podujatie
          </Link>
        </div>
      </div>

      <MetricsRow initial={overview} />

      {events.length === 0 ? (
        <div
          className="card-surface flex flex-col items-center justify-center px-6 py-20 text-center"
          style={{ borderStyle: 'dashed' }}
        >
          <div
            className="mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{
              background:
                'color-mix(in oklab, var(--color-accent) 15%, transparent)',
              color: 'var(--color-accent)',
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </div>
          <p className="font-display text-lg font-semibold text-ink-100">
            Zatiaľ žiadne podujatia
          </p>
          <p className="mt-1 text-sm text-ink-400">
            Vytvorte prvé podujatie a začnite predávať vstupenky.
          </p>
          <Link to="/app/events/new" className="btn-primary mt-6 text-sm">
            Vytvoriť podujatie
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3">
          {events.map((e: MyEventSummary) => {
            const s = STATUS[e.status]
            const pct =
              e.capacity > 0
                ? Math.min(100, Math.round((e.soldCount / e.capacity) * 100))
                : 0
            return (
              <li key={e.id}>
                <Link
                  to="/app/events/$eventId"
                  params={{ eventId: e.id }}
                  className="card-surface group block p-5 transition hover:-translate-y-0.5"
                  style={{ transitionDuration: '150ms' }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-lg font-semibold text-ink-100 transition group-hover:text-white">
                          {e.title}
                        </span>
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ background: s.bg, color: s.text }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: s.dot }}
                          />
                          {s.label}
                        </span>
                      </div>
                      <div className="mt-1.5 text-sm text-ink-400">
                        {fmtDate(e.starts_at, e.timezone)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-lg font-semibold tabular-nums text-ink-100">
                        {e.soldCount}
                        <span className="text-ink-500">/{e.capacity}</span>
                      </div>
                      <div className="text-xs text-ink-400">
                        {e.ticketTypeCount}{' '}
                        {e.ticketTypeCount === 1 ? 'typ' : 'typy'} vstupeniek
                      </div>
                    </div>
                  </div>
                  <div
                    className="mt-4 h-1 overflow-hidden rounded-full"
                    style={{ background: 'var(--color-ink-800)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background:
                          'linear-gradient(90deg, var(--color-accent-dim), var(--color-accent))',
                      }}
                    />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
