import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { listMySettlementsFn } from '../server/settlements'
import { getPayoutInfoFn, requestPayoutFn } from '../server/dashboard'
import type { PayoutInfo, PayoutStatus } from '../server/dashboard'
import { formatEur } from '../lib/money'

export const Route = createFileRoute('/app/settlements')({
  loader: async () => ({
    settlements: await listMySettlementsFn(),
    payout: await getPayoutInfoFn(),
  }),
  component: SettlementsPage,
})

const PAYOUT_STATUS: Record<PayoutStatus, { label: string; cls: string }> = {
  requested: { label: 'Požiadané', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Schválené', cls: 'bg-blue-100 text-blue-700' },
  paid: { label: 'Vyplatené', cls: 'bg-green-100 text-green-700' },
  rejected: { label: 'Zamietnuté', cls: 'bg-gray-100 text-gray-500' },
}

function PayoutSection({ payout }: { payout: PayoutInfo }) {
  const router = useRouter()
  const [amount, setAmount] = useState(
    payout.availableCents > 0 ? (payout.availableCents / 100).toFixed(2) : '',
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat('sk-SK', {
      dateStyle: 'short',
      timeZone: 'Europe/Bratislava',
    }).format(new Date(iso))

  const submit = async () => {
    const cents = Math.round(parseFloat(amount.replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setMsg({ ok: false, text: 'Zadajte platnú sumu.' })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const res = await requestPayoutFn({
        data: { amountCents: cents, note: note.trim() || null },
      })
      if ('error' in res) {
        setMsg({ ok: false, text: res.error })
      } else {
        setMsg({ ok: true, text: 'Žiadosť odoslaná.' })
        setNote('')
        router.invalidate()
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-white p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">Dostupné na vyplatenie</div>
          <div className="mt-1 font-display text-3xl font-bold tabular-nums">
            {formatEur(Math.max(0, payout.availableCents))}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Suma (€)</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-28 rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Poznámka</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-48 rounded-md border px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={submit}
            disabled={busy || payout.availableCents <= 0}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Požiadať o vyplatenie
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            msg.ok
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}

      {payout.requests.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-gray-500">
                <th className="py-2 pr-3">Dátum</th>
                <th className="py-2 pr-3 text-right">Suma</th>
                <th className="py-2 pr-3">Stav</th>
                <th className="py-2">Poznámka</th>
              </tr>
            </thead>
            <tbody>
              {payout.requests.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 text-gray-600">
                    {fmtDate(r.createdAt)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatEur(r.amountCents)}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAYOUT_STATUS[r.status].cls}`}
                    >
                      {PAYOUT_STATUS[r.status].label}
                    </span>
                  </td>
                  <td className="py-2 text-gray-500">{r.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function SettlementsPage() {
  const { settlements, payout } = Route.useLoaderData()

  const monthLabel = (iso: string) =>
    new Intl.DateTimeFormat('sk-SK', {
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Bratislava',
    }).format(new Date(iso))

  return (
    <div className="space-y-5">
      <div>
        <Link to="/app" className="text-sm text-indigo-600 hover:underline">
          ← Späť na podujatia
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Vyúčtovania</h1>
        <p className="mt-1 text-sm text-gray-500">
          Mesačný súhrn tržieb, provízie a netto. Generuje sa 1. deň v mesiaci
          za predchádzajúci mesiac.
        </p>
      </div>

      <PayoutSection payout={payout} />

      <section className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-3">Obdobie</th>
              <th className="px-4 py-3 text-right">Objednávky</th>
              <th className="px-4 py-3 text-right">Hrubé tržby</th>
              <th className="px-4 py-3 text-right">Provízia</th>
              <th className="px-4 py-3 text-right">Refundácie</th>
              <th className="px-4 py-3 text-right">Netto</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {settlements.map((s) => (
              <tr
                key={s.id}
                className="border-b last:border-0 hover:bg-gray-50"
              >
                <td className="px-4 py-3 font-medium capitalize">
                  {monthLabel(s.period_start)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {s.order_count}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatEur(s.gross_cents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                  {formatEur(s.fee_cents)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">
                  {formatEur(s.refunded_cents)}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {formatEur(s.net_cents)}
                </td>
                <td className="px-4 py-3 text-right">
                  <a
                    href={`/api/settlements/${s.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-gray-50"
                  >
                    PDF
                  </a>
                </td>
              </tr>
            ))}
            {settlements.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  Zatiaľ žiadne vyúčtovania.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
