import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { listAllEventsFn, adminUnpublishEventFn } from '../server/admin-events'
import type { AdminEventItem } from '../server/admin-events'
import { cancelEventFn } from '../server/cancel-event'
import { formatEur } from '../lib/money'
import type { EventStatus } from '../lib/db-types'

export const Route = createFileRoute('/admin/events')({
  loader: async () => {
    const res = await listAllEventsFn()
    if ('error' in res) return [] as AdminEventItem[]
    return res
  },
  component: AdminEvents,
})

const STATUS_SK: Record<EventStatus, string> = {
  draft: 'Koncept',
  published: 'Zverejnené',
  ended: 'Ukončené',
  cancelled: 'Zrušené',
}
const STATUS_CLS: Record<EventStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  published: 'bg-green-100 text-green-700',
  ended: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-red-100 text-red-700',
}

function AdminEvents() {
  const events = Route.useLoaderData()
  const router = useRouter()
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const filtered = events.filter((e) => {
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return (
      e.title.toLowerCase().includes(needle) ||
      e.organizerName.toLowerCase().includes(needle)
    )
  })

  const unpublish = async (e: AdminEventItem) => {
    if (
      !confirm(
        `Skryť podujatie „${e.title}“? Vráti sa do konceptu a zmizne z verejnosti.`,
      )
    )
      return
    setBusyId(e.id)
    await adminUnpublishEventFn({ data: { eventId: e.id } })
    setBusyId(null)
    router.invalidate()
  }

  const cancelEvent = async (e: AdminEventItem) => {
    const typed = prompt(
      `ZRUŠIŤ podujatie a spustiť hromadné refundácie všetkých zaplatených objednávok.\n\nPre potvrdenie napíšte presný názov podujatia:\n„${e.title}“`,
    )
    if (typed === null) return
    setBusyId(e.id)
    const res = await cancelEventFn({
      data: { eventId: e.id, confirmTitle: typed },
    })
    setBusyId(null)
    if ('error' in res) {
      alert(res.error)
    } else {
      alert(
        res.alreadyCancelled
          ? 'Podujatie už bolo zrušené. Refundácie boli doplnené.'
          : `Podujatie zrušené. Zaradených refundácií: ${res.enqueued}.`,
      )
      router.invalidate()
    }
  }

  const fmtDate = (iso: string, tz: string) =>
    new Intl.DateTimeFormat('sk-SK', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: tz,
    }).format(new Date(iso))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Podujatia</h1>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Hľadať názov alebo organizátora…"
          className="w-72 rounded-md border px-3 py-2 text-sm"
        />
      </div>

      <section className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-3">Podujatie</th>
              <th className="px-4 py-3">Organizátor</th>
              <th className="px-4 py-3">Termín</th>
              <th className="px-4 py-3">Stav</th>
              <th className="px-4 py-3 text-right">Predané</th>
              <th className="px-4 py-3 text-right">Tržby</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr
                key={e.id}
                className="border-b last:border-0 hover:bg-gray-50"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{e.title}</div>
                  <a
                    href={`/e/${e.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    /e/{e.slug} ↗
                  </a>
                </td>
                <td className="px-4 py-3">
                  <Link
                    to="/admin/organizers/$organizerId"
                    params={{ organizerId: e.organizerId }}
                    className="text-indigo-600 hover:underline"
                  >
                    {e.organizerName}
                  </Link>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                  {fmtDate(e.starts_at, e.timezone)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[e.status]}`}
                  >
                    {STATUS_SK[e.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {e.soldCount} / {e.capacity}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatEur(e.grossCents)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1.5">
                    {e.status === 'published' && (
                      <button
                        onClick={() => unpublish(e)}
                        disabled={busyId === e.id}
                        className="rounded-md border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Skryť
                      </button>
                    )}
                    {e.status !== 'cancelled' && (
                      <button
                        onClick={() => cancelEvent(e)}
                        disabled={busyId === e.id}
                        className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Zrušiť + refund
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  Žiadne podujatia.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
