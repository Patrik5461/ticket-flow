import { createFileRoute, Link, notFound, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { getEventSalesFn, type SalesData } from '../server/dashboard'
import { formatEur } from '../lib/money'
import type { OrderStatus } from '../lib/db-types'

export const Route = createFileRoute('/app/events/$eventId/sales')({
  loader: async ({ params }) => {
    const res = await getEventSalesFn({ data: { eventId: params.eventId } })
    if (!res || 'error' in res) throw notFound()
    return res as SalesData
  },
  component: SalesPage,
})

const STATUS_SK: Record<OrderStatus, string> = {
  pending: 'Čaká na platbu',
  paid: 'Zaplatené',
  expired: 'Expirované',
  cancelled: 'Zrušené',
  refunded: 'Vrátené',
}

const STATUS_CLS: Record<OrderStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-700',
  expired: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-gray-100 text-gray-500',
  refunded: 'bg-red-100 text-red-700',
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  )
}

function SalesPage() {
  const { eventId } = Route.useParams()
  const data = Route.useLoaderData()
  const router = useRouter()
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all')

  const orders =
    filter === 'all' ? data.orders : data.orders.filter((o) => o.status === filter)

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat('sk-SK', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: data.event.timezone,
    }).format(new Date(iso))

  const csvHref =
    `/api/events/${eventId}/sales-csv` + (filter !== 'all' ? `?status=${filter}` : '')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/app/events/$eventId"
            params={{ eventId }}
            className="text-sm text-indigo-600 hover:underline"
          >
            ← Späť na podujatie
          </Link>
          <h1 className="mt-2 text-2xl font-bold">Predaj — {data.event.title}</h1>
        </div>
        <button
          onClick={() => router.invalidate()}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Obnoviť
        </button>
      </div>

      {/* Totals (realized revenue = paid orders) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Hrubé tržby" value={formatEur(data.totals.grossCents)} />
        <Stat label="Provízia platformy" value={formatEur(data.totals.feeCents)} />
        <Stat label="Netto pre vás" value={formatEur(data.totals.netCents)} />
        <Stat label="Zaplatené objednávky" value={String(data.totals.paidOrderCount)} />
      </div>
      <p className="-mt-3 text-xs text-gray-500">
        Súčty zahŕňajú len zaplatené objednávky.
      </p>

      {/* Per-type sold */}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">Predané vstupenky podľa typu</h2>
        <table className="w-full text-sm">
          <tbody>
            {data.perType.map((t) => (
              <tr key={t.name} className="border-t first:border-t-0">
                <td className="py-1.5">{t.name}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-600">
                  {t.soldQty} / {t.capacity}
                </td>
              </tr>
            ))}
            {data.perType.length === 0 && (
              <tr>
                <td className="py-2 text-gray-500">Žiadne typy vstupeniek.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Orders */}
      <section className="rounded-lg border bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Stav:</label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as OrderStatus | 'all')}
              className="rounded-md border px-2 py-1 text-sm"
            >
              <option value="all">Všetky</option>
              {(Object.keys(STATUS_SK) as OrderStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_SK[s]}
                </option>
              ))}
            </select>
          </div>
          <a
            href={csvHref}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Export CSV
          </a>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-2 pr-3">Číslo</th>
                <th className="py-2 pr-3">Dátum</th>
                <th className="py-2 pr-3">E-mail</th>
                <th className="py-2 pr-3">Vstupenky</th>
                <th className="py-2 pr-3 text-right">Suma</th>
                <th className="py-2">Stav</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="py-2 pr-3 font-mono text-xs">{o.ref}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-600">
                    {fmtDate(o.created_at)}
                  </td>
                  <td className="py-2 pr-3">
                    {o.buyer_email}
                    {o.buyer_name && (
                      <div className="text-xs text-gray-400">{o.buyer_name}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-gray-600">{o.itemsLabel}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatEur(o.total_cents)}
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[o.status]}`}
                    >
                      {STATUS_SK[o.status]}
                    </span>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-gray-500">
                    Žiadne objednávky.
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
