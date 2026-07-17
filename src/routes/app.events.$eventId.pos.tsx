import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { getMyEventFn } from '../server/dashboard'
import { createPosOrderFn } from '../server/pos'
import { formatEur, toCents } from '../lib/money'
import type { TicketTypeRow } from '../lib/db-types'

export const Route = createFileRoute('/app/events/$eventId/pos')({
  loader: async ({ params }) => {
    const res = await getMyEventFn({ data: { eventId: params.eventId } })
    if ('error' in res) throw notFound()
    return res
  },
  component: PosPage,
})

/** Units still sellable for a type (mirrors reserve_ticket_capacity's guard). */
function availableOf(t: TicketTypeRow): number {
  return Math.max(0, t.capacity - t.sold_count)
}

function PosPage() {
  const { eventId } = Route.useParams()
  const { event, ticketTypes } = Route.useLoaderData()

  // Quantity picked per ticket type, keyed by ticket_type_id.
  const [qty, setQty] = useState<Record<string, number>>({})
  const [checkoutOpen, setCheckoutOpen] = useState(false)

  const setTypeQty = (t: TicketTypeRow, next: number) => {
    const clamped = Math.min(Math.max(0, next), availableOf(t))
    setQty((q) => ({ ...q, [t.id]: clamped }))
  }

  const lines = useMemo(
    () =>
      ticketTypes
        .map((t) => ({ type: t, quantity: qty[t.id] ?? 0 }))
        .filter((l) => l.quantity > 0),
    [ticketTypes, qty],
  )
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0)
  const totalCents = lines.reduce(
    (s, l) => s + l.quantity * l.type.price_cents,
    0,
  )

  const reset = () => setQty({})

  return (
    <div className="space-y-6 pb-28">
      {/* Header */}
      <div>
        <Link
          to="/app/events/$eventId"
          params={{ eventId }}
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Späť na podujatie
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Pokladňa (POS) — {event.title}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Rýchly predaj na mieste. Vyberte počty vstupeniek a stlačte „Predať".
        </p>
      </div>

      {/* Ticket-type tiles */}
      {ticketTypes.length === 0 ? (
        <p className="rounded-lg border bg-white p-6 text-sm text-gray-500">
          Toto podujatie zatiaľ nemá žiadne typy vstupeniek. Najprv ich pridajte
          v nastaveniach podujatia.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {ticketTypes.map((t) => (
            <TicketTile
              key={t.id}
              type={t}
              quantity={qty[t.id] ?? 0}
              onChange={(n) => setTypeQty(t, n)}
            />
          ))}
        </div>
      )}

      {/* Sticky sell bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {totalQty} {totalQty === 1 ? 'vstupenka' : 'vstupeniek'}
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {formatEur(totalCents)}
            </div>
          </div>
          {totalQty > 0 && (
            <button
              onClick={reset}
              className="rounded-lg border px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Vyčistiť
            </button>
          )}
          <button
            onClick={() => setCheckoutOpen(true)}
            disabled={totalQty === 0}
            className="rounded-lg bg-indigo-600 px-8 py-4 text-lg font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Predať
          </button>
        </div>
      </div>

      {checkoutOpen && (
        <CheckoutModal
          eventId={eventId}
          lines={lines}
          totalCents={totalCents}
          onClose={() => setCheckoutOpen(false)}
          onCompleted={() => {
            setCheckoutOpen(false)
            reset()
          }}
        />
      )}
    </div>
  )
}

function TicketTile({
  type,
  quantity,
  onChange,
}: {
  type: TicketTypeRow
  quantity: number
  onChange: (next: number) => void
}) {
  const available = availableOf(type)
  const soldOut = available === 0

  return (
    <div
      className={`flex flex-col justify-between rounded-xl border p-4 ${
        soldOut ? 'bg-gray-50 opacity-60' : 'bg-white'
      } ${quantity > 0 ? 'border-indigo-400 ring-1 ring-indigo-300' : ''}`}
    >
      {/* Tap the body to add one — big, fast target */}
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        disabled={soldOut || quantity >= available}
        className="min-h-[72px] text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="font-semibold leading-tight">{type.name}</div>
          {type.hidden && (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">
              skrytý
            </span>
          )}
        </div>
        <div className="mt-1 text-lg font-bold text-indigo-600 tabular-nums">
          {formatEur(type.price_cents)}
        </div>
        <div className="mt-0.5 text-xs text-gray-400">
          {soldOut ? 'Vypredané' : `zostáva ${available}`}
        </div>
      </button>

      {/* Stepper */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange(quantity - 1)}
          disabled={quantity === 0}
          className="h-12 w-12 rounded-lg border text-2xl font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-30"
          aria-label="Odobrať"
        >
          −
        </button>
        <span className="min-w-[2ch] text-center text-2xl font-bold tabular-nums">
          {quantity}
        </span>
        <button
          type="button"
          onClick={() => onChange(quantity + 1)}
          disabled={soldOut || quantity >= available}
          className="h-12 w-12 rounded-lg border bg-indigo-600 text-2xl font-bold text-white hover:bg-indigo-700 disabled:opacity-30"
          aria-label="Pridať"
        >
          +
        </button>
      </div>
    </div>
  )
}

interface CartLine {
  type: TicketTypeRow
  quantity: number
}

type PayMethod = 'cash' | 'terminal'

/** Cash quick-pick suggestions: exact, then the next round notes above total. */
function cashSuggestions(totalCents: number): number[] {
  const out = new Set<number>([totalCents])
  for (const note of [500, 1000, 2000, 5000, 10000]) {
    out.add(Math.ceil(totalCents / note) * note)
  }
  return [...out].sort((a, b) => a - b).slice(0, 5)
}

function CheckoutModal({
  eventId,
  lines,
  totalCents,
  onClose,
  onCompleted,
}: {
  eventId: string
  lines: CartLine[]
  totalCents: number
  onClose: () => void
  onCompleted: () => void
}) {
  const [method, setMethod] = useState<PayMethod | null>(null)
  const [receivedEur, setReceivedEur] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [doneOrderId, setDoneOrderId] = useState<string | null>(null)

  const receivedCents = receivedEur ? toCents(parseFloat(receivedEur)) : 0
  const changeCents = receivedCents - totalCents
  const emailOk = email.trim() === '' || /.+@.+\..+/.test(email.trim())
  const canComplete =
    !busy &&
    emailOk &&
    (method === 'terminal' ||
      (method === 'cash' && receivedCents >= totalCents))

  const complete = async () => {
    if (!method || !canComplete) return
    setBusy(true)
    setErr(null)
    const res = await createPosOrderFn({
      data: {
        eventId,
        items: lines.map((l) => ({
          ticketTypeId: l.type.id,
          quantity: l.quantity,
        })),
        paymentMethod: method,
        cashReceivedCents: method === 'cash' ? receivedCents : null,
        buyerEmail: email.trim() || null,
      },
    })
    setBusy(false)
    if ('error' in res) {
      setErr(res.error)
      return
    }
    setDoneOrderId(res.orderId)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        {doneOrderId ? (
          <SaleDone orderId={doneOrderId} onCompleted={onCompleted} />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Predaj</h2>
              <button
                onClick={onClose}
                className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
              >
                Zavrieť
              </button>
            </div>

            <ul className="space-y-2">
              {lines.map((l) => (
                <li key={l.type.id} className="flex justify-between text-sm">
                  <span>
                    {l.quantity}× {l.type.name}
                  </span>
                  <span className="tabular-nums">
                    {formatEur(l.quantity * l.type.price_cents)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex justify-between border-t pt-3 text-lg font-bold">
              <span>Spolu</span>
              <span className="tabular-nums">{formatEur(totalCents)}</span>
            </div>

            {/* Payment method */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => setMethod('cash')}
                className={`rounded-xl border-2 px-4 py-5 text-center font-semibold ${
                  method === 'cash'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                💶 Hotovosť
              </button>
              <button
                onClick={() => setMethod('terminal')}
                className={`rounded-xl border-2 px-4 py-5 text-center font-semibold ${
                  method === 'terminal'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                💳 Kartou (terminál)
              </button>
            </div>

            {/* Cash: received + change */}
            {method === 'cash' && (
              <div className="mt-4 rounded-lg border bg-gray-50 p-4">
                <label className="block text-sm font-medium text-gray-600">
                  Prijaté (€)
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={receivedEur}
                    onChange={(e) => setReceivedEur(e.target.value)}
                    placeholder="0,00"
                    className="mt-1 w-full rounded-md border px-3 py-3 text-2xl font-bold tabular-nums"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {cashSuggestions(totalCents).map((c) => (
                    <button
                      key={c}
                      onClick={() => setReceivedEur((c / 100).toFixed(2))}
                      className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-gray-100"
                    >
                      {formatEur(c)}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex justify-between text-lg font-bold">
                  <span className="text-gray-600">Výdavok</span>
                  <span
                    className={`tabular-nums ${
                      changeCents < 0 ? 'text-red-600' : 'text-green-700'
                    }`}
                  >
                    {formatEur(Math.max(0, changeCents))}
                  </span>
                </div>
                {changeCents < 0 && (
                  <p className="mt-1 text-right text-xs text-red-600">
                    Chýba {formatEur(-changeCents)}
                  </p>
                )}
              </div>
            )}

            {/* Optional buyer e-mail */}
            <div className="mt-4">
              <label className="block text-sm text-gray-600">
                E-mail kupujúceho (voliteľné) — pošleme vstupenky
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="napr. jozko@example.sk"
                  className={`mt-1 w-full rounded-md border px-3 py-2 text-sm ${
                    emailOk ? '' : 'border-red-400'
                  }`}
                />
              </label>
            </div>

            {err && <p className="mt-3 text-sm text-red-600">{err}</p>}

            <button
              onClick={complete}
              disabled={!canComplete}
              className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-4 text-lg font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {busy
                ? 'Dokončujem…'
                : `Dokončiť predaj · ${formatEur(totalCents)}`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function SaleDone({
  orderId,
  onCompleted,
}: {
  orderId: string
  onCompleted: () => void
}) {
  return (
    <div className="py-4 text-center">
      <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-700">
        ✓
      </div>
      <h2 className="text-xl font-bold">Predaj dokončený</h2>
      <p className="mt-1 text-sm text-gray-500">
        Vstupenky sú vygenerované. Vytlačte doklad a vstupenky, alebo začnite
        nový predaj.
      </p>
      <div className="mt-6 space-y-3">
        <a
          href={`/pos-receipt/${orderId}`}
          target="_blank"
          rel="noreferrer"
          className="block w-full rounded-lg bg-indigo-600 px-4 py-4 text-lg font-semibold text-white hover:bg-indigo-700"
        >
          🖨 Vytlačiť doklad a vstupenky
        </a>
        <button
          onClick={onCompleted}
          className="block w-full rounded-lg border px-4 py-3 text-base font-medium hover:bg-gray-50"
        >
          Nový predaj
        </button>
      </div>
    </div>
  )
}
