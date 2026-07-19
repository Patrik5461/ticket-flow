import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import { useState } from 'react'
import { getMyEventFn } from '../server/dashboard'
import { importGuestlistFn, getGuestlistFn } from '../server/guestlist'
import type { GuestRow } from '../server/guestlist'
import type { TicketStatus } from '../lib/db-types'

export const Route = createFileRoute('/app/events/$eventId/guestlist')({
  loader: async ({ params }) => {
    const [ev, guests] = await Promise.all([
      getMyEventFn({ data: { eventId: params.eventId } }),
      getGuestlistFn({ data: { eventId: params.eventId } }),
    ])
    if ('error' in ev) throw notFound()
    return {
      event: ev.event,
      ticketTypes: ev.ticketTypes,
      guests: 'error' in guests ? [] : guests,
    }
  },
  component: GuestlistPage,
})

const STATUS_SK: Record<TicketStatus, string> = {
  valid: 'Platná',
  used: 'Odbavená',
  cancelled: 'Zrušená',
}
const STATUS_CLS: Record<TicketStatus, string> = {
  valid: 'bg-gray-100 text-gray-600',
  used: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

function GuestlistPage() {
  const { eventId } = Route.useParams()
  const { event, ticketTypes, guests } = Route.useLoaderData()
  const router = useRouter()

  const [ticketTypeId, setTicketTypeId] = useState(ticketTypes[0]?.id ?? '')
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setCsv(await file.text())
  }

  const doImport = async () => {
    if (!ticketTypeId || !csv.trim()) return
    setBusy(true)
    setMsg(null)
    const res = await importGuestlistFn({
      data: { eventId, ticketTypeId, csv },
    })
    setBusy(false)
    if ('error' in res) {
      setMsg(res.error)
      return
    }
    const parts = [`vytvorených ${res.created}`]
    if (res.skipped) parts.push(`preskočených ${res.skipped}`)
    if (res.capacityShort) parts.push(`nezmestilo sa ${res.capacityShort}`)
    setMsg(`Hotovo: ${parts.join(', ')}. Vstupenky sa rozosielajú na pozadí.`)
    setCsv('')
    router.invalidate()
  }

  const usedCount = guests.filter((g: GuestRow) => g.status === 'used').length

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          to="/app/events/$eventId"
          params={{ eventId }}
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Späť na podujatie
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Guestlist — {event.title}</h1>
      </div>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold">Import kontaktov (CSV)</h2>
        <p className="mb-4 text-sm text-gray-500">
          CSV s hlavičkou — stĺpce „meno" a „email". Každému kontaktu sa vytvorí
          vstupenka zdarma a pošle e-mailom.
        </p>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-gray-600">Typ vstupenky</span>
            <select
              value={ticketTypeId}
              onChange={(e) => setTicketTypeId(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {ticketTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="text-sm"
          />
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={6}
            placeholder={'meno,email\nJana Nováková,jana@example.sk'}
            className="w-full rounded-md border px-3 py-2 font-mono text-xs"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={doImport}
              disabled={busy || !ticketTypeId || !csv.trim()}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? 'Importujem…' : 'Importovať a rozoslať'}
            </button>
            {msg && <span className="text-sm text-gray-600">{msg}</span>}
          </div>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Guestlist</h2>
          <span className="text-sm text-gray-500">
            Odbavených {usedCount} / {guests.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-cards">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-2 pr-3">Meno</th>
                <th className="py-2 pr-3">E-mail</th>
                <th className="py-2 pr-3">Typ</th>
                <th className="py-2">Stav</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((g: GuestRow) => (
                <tr key={g.id} className="border-t">
                  <td className="py-2 pr-3">{g.holderName ?? '—'}</td>
                  <td className="py-2 pr-3 text-gray-600">{g.holderEmail}</td>
                  <td className="py-2 pr-3 text-gray-600">{g.typeName}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[g.status]}`}
                    >
                      {STATUS_SK[g.status]}
                    </span>
                  </td>
                </tr>
              ))}
              {guests.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-gray-500">
                    Zatiaľ žiadni hostia.
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
