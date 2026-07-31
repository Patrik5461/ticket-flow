import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import {
  listNonprofitRequestsFn,
  decideNonprofitRequestFn,
} from '../server/nonprofit'
import type { NonprofitRequest } from '../server/nonprofit'
import { formatEur } from '../lib/money'
import { formatSk } from '../lib/datetime'

export const Route = createFileRoute('/admin/nonprofit')({
  loader: async (): Promise<NonprofitRequest[]> => {
    const res = await listNonprofitRequestsFn()
    return 'error' in res ? [] : res
  },
  component: NonprofitPage,
})

function Row({ r }: { r: NonprofitRequest }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const decide = async (approve: boolean) => {
    // A rejection with no reason leaves the applicant guessing — the settings
    // page shows this text back to them verbatim.
    if (!approve && !reason.trim()) {
      setErr('Pri zamietnutí uveďte dôvod.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await decideNonprofitRequestFn({
        data: {
          organizerId: r.organizerId,
          approve,
          reason: reason.trim() || undefined,
        },
      })
      if ('error' in res) setErr(res.error)
      else router.invalidate()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <tr className="border-b align-top last:border-0">
      <td className="px-4 py-3 text-gray-600">
        {r.requestedAt
          ? formatSk(r.requestedAt, 'date', 'Europe/Bratislava')
          : '—'}
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{r.name}</div>
        <div className="text-xs text-gray-500">{r.slug}</div>
      </td>
      <td className="px-4 py-3">{r.legalFormLabel ?? '—'}</td>
      <td className="px-4 py-3 tabular-nums">{r.ico ?? '—'}</td>
      <td className="px-4 py-3 text-gray-600">
        {r.feePercent} % / min {formatEur(r.feeMinCents)}
      </td>
      <td className="px-4 py-3 text-gray-600">
        {r.note ? (
          <span className="whitespace-pre-wrap">{r.note}</span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Dôvod (pri zamietnutí)"
            disabled={busy}
            className="w-48 rounded-md border px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => decide(true)}
              disabled={busy}
              className="rounded-md bg-green-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
            >
              Schváliť
            </button>
            <button
              onClick={() => decide(false)}
              disabled={busy}
              className="rounded-md border px-3 py-1 text-sm font-medium disabled:opacity-50"
            >
              Zamietnuť
            </button>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      </td>
    </tr>
  )
}

function NonprofitPage() {
  const rows = Route.useLoaderData()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Neziskové sadzby</h1>
        <p className="text-sm text-gray-500">
          Žiadosti o zníženú províziu. Schválenie prepíše províziu organizátora
          na aktuálnu neziskovú sadzbu a uplatní sa na objednávky vytvorené po
          schválení — staršie vyúčtovania sa neprepočítavajú.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border bg-white p-6 text-sm text-gray-500">
          Žiadne čakajúce žiadosti.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Podaná</th>
                <th className="px-4 py-3 font-medium">Organizátor</th>
                <th className="px-4 py-3 font-medium">Právna forma</th>
                <th className="px-4 py-3 font-medium">IČO</th>
                <th className="px-4 py-3 font-medium">Terajšia provízia</th>
                <th className="px-4 py-3 font-medium">Poznámka</th>
                <th className="px-4 py-3 font-medium">Rozhodnutie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.organizerId} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
