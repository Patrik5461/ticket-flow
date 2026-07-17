import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import { getPosSummaryFn } from '../server/pos'
import { formatEur } from '../lib/money'

export const Route = createFileRoute('/app/events/$eventId/pos-summary')({
  loader: async ({ params }) => {
    const res = await getPosSummaryFn({ data: { eventId: params.eventId } })
    if ('error' in res) throw notFound()
    return res
  },
  component: PosSummaryPage,
})

const METHOD_SK: Record<'cash' | 'terminal', string> = {
  cash: 'Hotovosť',
  terminal: 'Terminál',
}

function Stat({
  label,
  value,
  sub,
  strong,
}: {
  label: string
  value: string
  sub?: string
  strong?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        strong ? 'border-indigo-300 bg-indigo-50' : 'bg-white'
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

function PosSummaryPage() {
  const { eventId } = Route.useParams()
  const data = Route.useLoaderData()
  const router = useRouter()

  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat('sk-SK', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: data.event.timezone,
    }).format(new Date(iso))

  const { totals, sellers, sales } = data

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/app/events/$eventId/sales"
            params={{ eventId }}
            className="text-sm text-indigo-600 hover:underline"
          >
            ← Späť na predaj
          </Link>
          <h1 className="mt-2 text-2xl font-bold">
            POS uzávierka — {data.event.title}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Prehľad predaja na mieste. Súčty zahŕňajú len dokončené POS predaje.
          </p>
        </div>
        <button
          onClick={() => router.invalidate()}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Obnoviť
        </button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="V pokladni (na odovzdanie)"
          value={formatEur(totals.drawerCashCents)}
          sub="hotovosť spolu"
          strong
        />
        <Stat
          label="Hotovosť"
          value={formatEur(totals.cashCents)}
          sub={`${totals.cashCount} predajov`}
        />
        <Stat
          label="Kartou (terminál)"
          value={formatEur(totals.terminalCents)}
          sub={`${totals.terminalCount} predajov`}
        />
        <Stat
          label="POS spolu"
          value={formatEur(totals.totalCents)}
          sub={`${totals.cashCount + totals.terminalCount} predajov`}
        />
      </div>

      {/* Per-seller breakdown */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">Podľa predajcu</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-2 pr-3">Predajca</th>
                <th className="py-2 pr-3 text-right">Hotovosť</th>
                <th className="py-2 pr-3 text-right">Terminál</th>
                <th className="py-2 text-right">Spolu</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <tr key={s.sellerEmail} className="border-t">
                  <td className="py-2 pr-3">{s.sellerEmail}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatEur(s.cashCents)}
                    <span className="ml-1 text-xs text-gray-400">
                      ({s.cashCount})
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatEur(s.terminalCents)}
                    <span className="ml-1 text-xs text-gray-400">
                      ({s.terminalCount})
                    </span>
                  </td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {formatEur(s.totalCents)}
                  </td>
                </tr>
              ))}
              {sellers.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-500">
                    Zatiaľ žiadne POS predaje.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sales list */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">POS predaje</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-2 pr-3">Doklad</th>
                <th className="py-2 pr-3">Čas</th>
                <th className="py-2 pr-3">Predajca</th>
                <th className="py-2 pr-3">Úhrada</th>
                <th className="py-2 pr-3">Vstupenky</th>
                <th className="py-2 text-right">Suma</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="py-2 pr-3 font-mono text-xs">
                    <a
                      href={`/pos-receipt/${s.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 hover:underline"
                    >
                      {s.ref}
                    </a>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-600">
                    {fmtTime(s.created_at)}
                  </td>
                  <td className="py-2 pr-3 text-gray-600">{s.sellerEmail}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.paymentMethod === 'cash'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {METHOD_SK[s.paymentMethod]}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-600">{s.itemsLabel}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatEur(s.totalCents)}
                  </td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-500">
                    Zatiaľ žiadne POS predaje.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
