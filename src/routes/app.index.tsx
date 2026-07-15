import { createFileRoute, Link } from '@tanstack/react-router'
import { listMyEventsFn, type MyEventSummary } from '../server/dashboard'
import type { EventStatus } from '../lib/db-types'

export const Route = createFileRoute('/app/')({
  loader: async () => ({ events: await listMyEventsFn() }),
  component: Dashboard,
})

const STATUS: Record<EventStatus, { label: string; cls: string }> = {
  draft: { label: 'Koncept', cls: 'bg-gray-100 text-gray-600' },
  published: { label: 'Zverejnené', cls: 'bg-green-100 text-green-700' },
  ended: { label: 'Ukončené', cls: 'bg-gray-100 text-gray-500' },
  cancelled: { label: 'Zrušené', cls: 'bg-red-100 text-red-700' },
}

function fmtDate(iso: string, tz: string) {
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: tz,
  }).format(new Date(iso))
}

function Dashboard() {
  const { events } = Route.useLoaderData()

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Moje podujatia</h1>
        <div className="flex items-center gap-3">
          <Link
            to="/app/settlements"
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Vyúčtovania
          </Link>
          <Link
            to="/app/events/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + Nové podujatie
          </Link>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-white p-12 text-center text-gray-500">
          Zatiaľ nemáte žiadne podujatia. Vytvorte prvé.
        </div>
      ) : (
        <ul className="space-y-3">
          {events.map((e: MyEventSummary) => {
            const s = STATUS[e.status]
            return (
              <li key={e.id}>
                <Link
                  to="/app/events/$eventId"
                  params={{ eventId: e.id }}
                  className="flex items-center justify-between rounded-lg border bg-white p-4 transition hover:border-indigo-400"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{e.title}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}
                      >
                        {s.label}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-500">
                      {fmtDate(e.starts_at, e.timezone)}
                    </div>
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    <div className="tabular-nums">
                      {e.soldCount}/{e.capacity} predaných
                    </div>
                    <div className="text-xs">
                      {e.ticketTypeCount} typov vstupeniek
                    </div>
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
