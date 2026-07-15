import { createFileRoute, Link } from '@tanstack/react-router'
import { listEventsFn } from '../server/fns'

export const Route = createFileRoute('/')({
  loader: async () => ({ events: await listEventsFn() }),
  component: Landing,
})

function formatDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: tz,
  }).format(new Date(iso))
}

function Landing() {
  const { events } = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-12">
        <p className="text-sm font-semibold tracking-widest text-indigo-600">
          TICKETIO
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">
          Vstupenky na eventy, jednoducho
        </h1>
        <p className="mt-3 text-lg text-gray-600">
          Transparentný cenník, priebežný payout, moderné odbavenie.
        </p>
      </header>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Aktuálne podujatia</h2>
        {events.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-gray-500">
            Zatiaľ nie sú zverejnené žiadne podujatia.
          </p>
        ) : (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id}>
                <Link
                  to="/e/$slug"
                  params={{ slug: e.slug }}
                  className="block rounded-lg border p-4 transition hover:border-indigo-400 hover:shadow-sm"
                >
                  <div className="font-semibold">{e.title}</div>
                  <div className="mt-1 text-sm text-gray-500">
                    {formatDate(e.starts_at, e.timezone)}
                    {e.venue_name ? ` · ${e.venue_name}` : ''}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
