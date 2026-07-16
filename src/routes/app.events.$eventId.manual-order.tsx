import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import { getMyEventFn } from '../server/dashboard'
import { createManualOrderFn } from '../server/manual-order'
import { formatEur } from '../lib/money'

export const Route = createFileRoute('/app/events/$eventId/manual-order')({
  loader: async ({ params }) => {
    const ev = await getMyEventFn({ data: { eventId: params.eventId } })
    if ('error' in ev) throw notFound()
    return ev
  },
  component: ManualOrderPage,
})

function ManualOrderPage() {
  const { eventId } = Route.useParams()
  const { event, ticketTypes } = Route.useLoaderData()

  const [qty, setQty] = useState<Record<string, number>>({})
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const items = ticketTypes
    .map((t) => ({ ticketTypeId: t.id, quantity: qty[t.id] ?? 0 }))
    .filter((i) => i.quantity > 0)
  const total = ticketTypes.reduce(
    (s, t) => s + (qty[t.id] ?? 0) * t.price_cents,
    0,
  )
  const canSubmit = items.length > 0 && /.+@.+\..+/.test(email) && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setMsg(null)
    const res = await createManualOrderFn({
      data: {
        eventId,
        items,
        buyer: {
          email: email.trim(),
          name: name.trim() || undefined,
          phone: phone.trim() || undefined,
        },
      },
    })
    setBusy(false)
    if ('error' in res) {
      setMsg({ ok: false, text: res.error })
      return
    }
    setMsg({ ok: true, text: 'Objednávka vytvorená, vstupenky odoslané.' })
    setQty({})
    setEmail('')
    setName('')
    setPhone('')
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          to="/app/events/$eventId"
          params={{ eventId }}
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Späť na podujatie
        </Link>
        <h1 className="mt-2 text-2xl font-bold">
          Ručná objednávka — {event.title}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Predaj na mieste alebo prevodom. Objednávka sa označí ako zaplatená
          (manuálne), vstupenky sa vygenerujú a pošlú kupujúcemu.
        </p>
      </div>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-3 text-lg font-semibold">Vstupenky</h2>
        <div className="space-y-2">
          {ticketTypes.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-gray-500">
                  {formatEur(t.price_cents)}
                </div>
              </div>
              <input
                type="number"
                min="0"
                max="100"
                value={qty[t.id] ?? 0}
                onChange={(e) =>
                  setQty((q) => ({
                    ...q,
                    [t.id]: Math.max(0, parseInt(e.target.value || '0', 10)),
                  }))
                }
                className="w-20 rounded-md border px-2 py-1 text-sm"
              />
            </div>
          ))}
          {ticketTypes.length === 0 && (
            <p className="text-sm text-gray-500">
              Najprv pridajte typy vstupeniek.
            </p>
          )}
        </div>
        <div className="mt-3 flex justify-between border-t pt-3 text-sm">
          <span className="text-gray-600">Spolu</span>
          <span className="font-bold tabular-nums">{formatEur(total)}</span>
        </div>
      </section>

      <section className="rounded-lg border bg-white p-6">
        <h2 className="mb-3 text-lg font-semibold">Kupujúci</h2>
        <div className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mail (povinný)"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Meno"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Telefón"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Vytváram…' : 'Vytvoriť objednávku a odoslať vstupenky'}
        </button>
        {msg && (
          <span
            className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  )
}
