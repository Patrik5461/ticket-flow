import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { listPayoutRequestsFn, resolvePayoutFn } from '../server/admin-payouts'
import type { AdminPayoutRow } from '../server/admin-payouts'
import { formatEur } from '../lib/money'

export const Route = createFileRoute('/admin/payouts')({
  loader: async (): Promise<AdminPayoutRow[]> => {
    const res = await listPayoutRequestsFn()
    return 'error' in res ? [] : res
  },
  component: PayoutsPage,
})

const STATUS: Record<AdminPayoutRow['status'], { label: string; cls: string }> =
  {
    requested: { label: 'Požiadané', cls: 'bg-amber-100 text-amber-800' },
    approved: { label: 'Schválené', cls: 'bg-blue-100 text-blue-700' },
    paid: { label: 'Vyplatené', cls: 'bg-green-100 text-green-700' },
    rejected: { label: 'Zamietnuté', cls: 'bg-gray-100 text-gray-500' },
  }

function Row({ r }: { r: AdminPayoutRow }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat('sk-SK', {
      dateStyle: 'short',
      timeZone: 'Europe/Bratislava',
    }).format(new Date(iso))

  const act = async (action: 'approve' | 'reject' | 'mark_paid') => {
    setBusy(true)
    setErr(null)
    try {
      const res = await resolvePayoutFn({
        data: { id: r.id, action, note: note.trim() || null },
      })
      if ('error' in res) setErr((res as { error: string }).error)
      else router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canApprove = r.status === 'requested'
  const canReject = r.status === 'requested' || r.status === 'approved'
  const canPay = r.status === 'approved'
  const open = canApprove || canReject || canPay

  return (
    <tr className="border-b last:border-0 align-top">
      <td className="px-4 py-3 text-gray-600">{fmtDate(r.createdAt)}</td>
      <td className="px-4 py-3 font-medium">{r.organizerName}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {formatEur(r.amountCents)}
      </td>
      <td className="px-4 py-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status].cls}`}
        >
          {STATUS[r.status].label}
        </span>
      </td>
      <td className="px-4 py-3 text-gray-500">{r.note ?? '—'}</td>
      <td className="px-4 py-3">
        {open ? (
          <div className="space-y-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Poznámka (voliteľné)"
              className="w-full rounded-md border px-2 py-1 text-xs"
            />
            <div className="flex flex-wrap gap-1.5">
              {canApprove && (
                <button
                  onClick={() => act('approve')}
                  disabled={busy}
                  className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Schváliť
                </button>
              )}
              {canPay && (
                <button
                  onClick={() => act('mark_paid')}
                  disabled={busy}
                  className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Označiť vyplatené
                </button>
              )}
              {canReject && (
                <button
                  onClick={() => act('reject')}
                  disabled={busy}
                  className="rounded-md border px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Zamietnuť
                </button>
              )}
            </div>
            {err && <p className="text-xs text-red-600">{err}</p>}
          </div>
        ) : (
          <span className="text-xs text-gray-400">Vybavené</span>
        )}
      </td>
    </tr>
  )
}

function PayoutsPage() {
  const rows = Route.useLoaderData()
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Žiadosti o vyplatenie</h1>
        <p className="mt-1 text-sm text-gray-500">
          Schvaľovanie a evidencia vyplatení. Samotný prevod je manuálny.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-3">Dátum</th>
              <th className="px-4 py-3">Organizátor</th>
              <th className="px-4 py-3 text-right">Suma</th>
              <th className="px-4 py-3">Stav</th>
              <th className="px-4 py-3">Poznámka</th>
              <th className="px-4 py-3">Akcia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.id} r={r} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  Žiadne žiadosti.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
