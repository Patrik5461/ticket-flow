import { createFileRoute, Link } from '@tanstack/react-router'
import { globalSearchFn } from '../server/admin-search'
import type { GlobalSearchResult } from '../server/admin-search'
import { formatEur } from '../lib/money'

export const Route = createFileRoute('/admin/search')({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === 'string' ? search.q : '',
  }),
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }): Promise<GlobalSearchResult | null> => {
    if (deps.q.trim().length < 2) return null
    const res = await globalSearchFn({ data: { query: deps.q.trim() } })
    return 'error' in res ? null : res
  },
  component: SearchPage,
})

function SearchPage() {
  const { q } = Route.useSearch()
  const res = Route.useLoaderData()

  const total = res
    ? res.organizers.length + res.events.length + res.orders.length
    : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Vyhľadávanie</h1>
        {q.trim().length >= 2 ? (
          <p className="mt-1 text-sm text-gray-500">
            {total} výsledkov pre „{q}“
          </p>
        ) : (
          <p className="mt-1 text-sm text-gray-500">
            Zadajte aspoň 2 znaky (e-mail, názov, IČO nie, číslo objednávky,
            GoPay ID).
          </p>
        )}
      </div>

      {res && (
        <>
          <Group title={`Organizátori (${res.organizers.length})`}>
            {res.organizers.map((o) => (
              <Link
                key={o.id}
                to="/admin/organizers/$organizerId"
                params={{ organizerId: o.id }}
                className="block rounded-md border bg-white px-4 py-2 text-sm hover:bg-gray-50"
              >
                <span className="font-medium">{o.name}</span>{' '}
                <span className="text-gray-400">/{o.slug}</span>
                <span className="ml-2 text-xs text-gray-400">{o.status}</span>
              </Link>
            ))}
          </Group>

          <Group title={`Podujatia (${res.events.length})`}>
            {res.events.map((e) => (
              <Link
                key={e.id}
                to="/admin/events"
                className="block rounded-md border bg-white px-4 py-2 text-sm hover:bg-gray-50"
              >
                <span className="font-medium">{e.title}</span>
                <span className="ml-2 text-xs text-gray-400">
                  {e.organizerName} · {e.status}
                </span>
              </Link>
            ))}
          </Group>

          <Group title={`Objednávky (${res.orders.length})`}>
            {res.orders.map((o) => (
              <Link
                key={o.id}
                to="/admin/orders/$orderId"
                params={{ orderId: o.id }}
                className="flex items-center justify-between gap-3 rounded-md border bg-white px-4 py-2 text-sm hover:bg-gray-50"
              >
                <span className="min-w-0">
                  <span className="font-mono">{o.ref}</span>{' '}
                  <span className="text-gray-600">{o.buyer_email}</span>
                  <span className="ml-2 block truncate text-xs text-gray-400">
                    {o.event_title} · {o.organizer_name}
                  </span>
                </span>
                <span className="whitespace-nowrap tabular-nums">
                  {formatEur(o.total_cents)}
                </span>
              </Link>
            ))}
          </Group>

          {total === 0 && (
            <p className="rounded-md border bg-white px-4 py-8 text-center text-gray-500">
              Nič sa nenašlo.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function Group({
  title,
  children,
}: {
  title: string
  children: React.ReactNode[]
}) {
  if (children.length === 0) return null
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-600">{title}</h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}
