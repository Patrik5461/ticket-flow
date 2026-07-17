import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { getMyEventFn } from '../server/dashboard'
import { formatEur } from '../lib/money'
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
          lines={lines}
          totalCents={totalCents}
          onClose={() => setCheckoutOpen(false)}
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

function CheckoutModal({
  lines,
  totalCents,
  onClose,
}: {
  lines: CartLine[]
  totalCents: number
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="w-full max-w-lg rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
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

        <div className="mt-3 flex justify-between border-t pt-3 text-base font-bold">
          <span>Spolu</span>
          <span className="tabular-nums">{formatEur(totalCents)}</span>
        </div>

        {/* Block 2 fills this in: payment method (cash / terminal), change
            calculation, order creation (paid_cash / paid_terminal, source=pos),
            ticket generation + print/e-mail. */}
        <div className="mt-6 rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-400">
          Spôsob úhrady a doklad — pripravujeme v ďalšom kroku.
        </div>

        <button
          disabled
          className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-4 text-lg font-semibold text-white disabled:opacity-40"
        >
          Dokončiť predaj
        </button>
      </div>
    </div>
  )
}
