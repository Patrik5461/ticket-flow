import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { searchOrdersFn } from '../server/admin-orders'
import type { OrderSearchItem } from '../server/admin-orders'
import { formatEur } from '../lib/money'
import type { OrderStatus } from '../lib/db-types'

export const Route = createFileRoute('/admin/orders/')({
  component: OrdersSearch,
})

const STATUS_SK: Record<OrderStatus, string> = {
  pending: 'Čaká na platbu',
  paid: 'Zaplatené',
  expired: 'Expirované',
  cancelled: 'Zrušené',
  refunded: 'Vrátené',
  partially_refunded: 'Čiastočne vrátené',
}
const STATUS_CLS: Record<OrderStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-700',
  expired: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-gray-100 text-gray-500',
  refunded: 'bg-red-100 text-red-700',
  partially_refunded: 'bg-amber-100 text-amber-800',
}

function OrdersSearch() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<OrderSearchItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const search = async (e: React.FormEvent) => {
    e.preventDefault()
    const query = q.trim()
    if (query.length < 2) return
    setBusy(true)
    setErr(null)
    const res = await searchOrdersFn({ data: { query } })
    setBusy(false)
    if ('error' in res) {
      setErr(res.error)
      setResults([])
    } else {
      setResults(res)
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Objednávky — podpora</h1>
      <form onSubmit={search} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="E-mail, číslo objednávky (celé alebo prvých 8), alebo GoPay ID"
          className="w-full max-w-xl rounded-md border px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || q.trim().length < 2}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Hľadám…' : 'Hľadať'}
        </button>
      </form>
      {err && <p className="text-sm text-red-600">{err}</p>}

      {results && (
        <section className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-gray-500">
                <th className="px-4 py-3">Číslo</th>
                <th className="px-4 py-3">Kupujúci</th>
                <th className="px-4 py-3">Podujatie</th>
                <th className="px-4 py-3">Organizátor</th>
                <th className="px-4 py-3 text-right">Suma</th>
                <th className="px-4 py-3">Stav</th>
              </tr>
            </thead>
            <tbody>
              {results.map((o) => (
                <tr
                  key={o.id}
                  className="border-b last:border-0 hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      to="/admin/orders/$orderId"
                      params={{ orderId: o.id }}
                      className="text-indigo-600 hover:underline"
                    >
                      {o.ref}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {o.buyer_email}
                    {o.buyer_name && (
                      <div className="text-xs text-gray-400">
                        {o.buyer_name}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">{o.event_title}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {o.organizer_name}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatEur(o.total_cents)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[o.status]}`}
                    >
                      {STATUS_SK[o.status]}
                    </span>
                  </td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-gray-500"
                  >
                    Žiadne objednávky pre tento dopyt.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
