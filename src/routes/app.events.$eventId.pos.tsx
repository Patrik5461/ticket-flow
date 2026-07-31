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
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-6 pb-28 lg:pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to="/app/events/$eventId"
            params={{ eventId }}
            className="text-sm text-accent hover:text-accent-dim hover:underline"
          >
            ← Späť na podujatie
          </Link>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-ink-100 sm:text-3xl">
            Pokladňa — <span className="text-ink-200">{event.title}</span>
          </h1>
          <p className="mt-1 text-sm text-ink-400">
            Rýchly predaj na mieste. Ťuknite na dlaždicu pre pridanie, potom „Predať".
          </p>
        </div>
        <Link
          to="/app/events/$eventId/pos-summary"
          params={{ eventId }}
          className="shrink-0 rounded-lg border border-ink-700 bg-ink-800/60 px-4 py-2 text-sm font-medium text-ink-200 hover:border-ink-600 hover:bg-ink-800"
        >
          Uzávierka →
        </Link>
      </div>

      {/* Two-column workspace */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* LEFT — ticket tile grid */}
        <div className="lg:col-span-3 xl:col-span-3">
          {ticketTypes.length === 0 ? (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 p-8 text-center text-sm text-ink-400">
              Toto podujatie zatiaľ nemá žiadne typy vstupeniek. Najprv ich pridajte
              v nastaveniach podujatia.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
        </div>

        {/* RIGHT — sticky receipt (desktop) */}
        <aside className="hidden lg:col-span-2 lg:block">
          <div className="sticky top-24">
            <ReceiptPanel
              lines={lines}
              totalQty={totalQty}
              totalCents={totalCents}
              onSell={() => setCheckoutOpen(true)}
              onReset={reset}
            />
          </div>
        </aside>
      </div>

      {/* Mobile sticky sell bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-700 bg-ink-950/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-ink-400">
              {totalQty} {totalQty === 1 ? 'vstupenka' : 'vstupeniek'} · Spolu
            </div>
            <div className="font-display text-2xl font-bold tabular-nums text-ink-100">
              {formatEur(totalCents)}
            </div>
          </div>
          {totalQty > 0 && (
            <button
              onClick={reset}
              className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-3 text-sm font-medium text-ink-200 hover:bg-ink-700"
            >
              Vyčistiť
            </button>
          )}
          <button
            onClick={() => setCheckoutOpen(true)}
            disabled={totalQty === 0}
            className="rounded-lg bg-accent px-6 py-3.5 text-base font-semibold text-ink-950 hover:bg-accent-dim disabled:bg-ink-700 disabled:text-ink-400"
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

function ReceiptPanel({
  lines,
  totalQty,
  totalCents,
  onSell,
  onReset,
}: {
  lines: CartLine[]
  totalQty: number
  totalCents: number
  onSell: () => void
  onReset: () => void
}) {
  const empty = lines.length === 0
  return (
    <div className="flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-2xl border border-ink-700 bg-ink-900/60 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
        <h2 className="font-display text-lg font-semibold text-ink-100">
          Objednávka
        </h2>
        <span className="rounded-full bg-ink-800 px-2.5 py-0.5 text-xs font-medium tabular-nums text-ink-300">
          {totalQty} ks
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {empty ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center text-sm text-ink-400">
            <div className="mb-2 text-3xl opacity-40">🧾</div>
            Zatiaľ nič nevybrané.
            <div className="mt-1 text-xs text-ink-400">
              Ťuknite na dlaždicu vľavo.
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {lines.map((l) => (
              <li
                key={l.type.id}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink-100">
                    {l.type.name}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-400 tabular-nums">
                    {l.quantity} × {formatEur(l.type.price_cents)}
                  </div>
                </div>
                <div className="shrink-0 font-semibold tabular-nums text-ink-100">
                  {formatEur(l.quantity * l.type.price_cents)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-ink-700 bg-ink-800/40 px-5 py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm uppercase tracking-wider text-ink-400">
            Spolu
          </span>
          <span className="font-display text-4xl font-bold tabular-nums text-accent">
            {formatEur(totalCents)}
          </span>
        </div>
        <button
          onClick={onSell}
          disabled={empty}
          className="mt-4 w-full rounded-xl bg-accent px-4 py-4 text-lg font-semibold text-ink-950 transition hover:bg-accent-dim disabled:bg-ink-700 disabled:text-ink-400"
        >
          Predať
        </button>
        <button
          onClick={onReset}
          disabled={empty}
          className="mt-2 w-full rounded-xl border border-ink-700 bg-transparent px-4 py-2.5 text-sm font-medium text-ink-300 hover:bg-ink-800 disabled:opacity-40"
        >
          Vyčistiť
        </button>
      </div>
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
  const active = quantity > 0

  return (
    <div
      className={`group relative flex flex-col rounded-xl border p-4 transition ${
        soldOut
          ? 'border-ink-800 bg-ink-900/40 opacity-50'
          : active
            ? 'border-accent/70 bg-ink-800'
            : 'border-ink-700 bg-ink-800/60 hover:border-ink-600 hover:bg-ink-800'
      }`}
    >
      {/* Tap the body to add one — big, fast target */}
      <button
        type="button"
        onClick={() => onChange(quantity + 1)}
        disabled={soldOut || quantity >= available}
        className="text-left"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="font-display text-base font-semibold leading-tight text-ink-100">
            {type.name}
          </div>
          {type.hidden && (
            <span className="shrink-0 rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-300">
              skrytý
            </span>
          )}
        </div>
        <div className="mt-1.5 font-display text-2xl font-bold tabular-nums text-ink-100">
          {formatEur(type.price_cents)}
        </div>
        <div className="mt-0.5 text-xs uppercase tracking-wider text-ink-400">
          {soldOut ? 'Vypredané' : `zostáva ${available}`}
        </div>
      </button>

      {/* Stepper */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange(quantity - 1)}
          disabled={quantity === 0}
          className="flex h-12 w-12 items-center justify-center rounded-lg border border-ink-600 bg-ink-950 text-2xl font-bold text-ink-200 hover:border-ink-500 hover:bg-ink-700 disabled:opacity-25"
          aria-label="Odobrať"
        >
          −
        </button>
        <span
          className={`min-w-[3ch] text-center font-display text-2xl font-bold tabular-nums ${
            active ? 'text-accent' : 'text-ink-200'
          }`}
        >
          {quantity}
        </span>
        <button
          type="button"
          onClick={() => onChange(quantity + 1)}
          disabled={soldOut || quantity >= available}
          className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-2xl font-bold text-ink-950 hover:bg-accent-dim disabled:bg-ink-700 disabled:text-ink-400"
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
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-ink-700 bg-ink-900 p-6 shadow-xl sm:rounded-2xl">
        {doneOrderId ? (
          <SaleDone orderId={doneOrderId} onCompleted={onCompleted} />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Predaj</h2>
              <button
                onClick={onClose}
                className="rounded-md px-2 py-1 text-sm text-ink-400 hover:bg-ink-800"
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

            <div className="mt-3 flex justify-between border-t border-ink-700 pt-3 text-lg font-bold">
              <span>Spolu</span>
              <span className="tabular-nums">{formatEur(totalCents)}</span>
            </div>

            {/* Payment method */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => setMethod('cash')}
                className={`rounded-xl border-2 px-4 py-5 text-center font-semibold ${
                  method === 'cash'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-ink-700 text-ink-200 hover:bg-ink-800'
                }`}
              >
                💶 Hotovosť
              </button>
              <button
                onClick={() => setMethod('terminal')}
                className={`rounded-xl border-2 px-4 py-5 text-center font-semibold ${
                  method === 'terminal'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-ink-700 text-ink-200 hover:bg-ink-800'
                }`}
              >
                💳 Kartou (terminál)
              </button>
            </div>

            {/* Cash: received + change */}
            {method === 'cash' && (
              <div className="mt-4 rounded-lg border border-ink-700 bg-ink-800/60 p-4">
                <label className="block text-sm font-medium text-ink-300">
                  Prijaté (€)
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={receivedEur}
                    onChange={(e) => setReceivedEur(e.target.value)}
                    placeholder="0,00"
                    className="mt-1 w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-3 text-2xl font-bold tabular-nums text-ink-100"
                  />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {cashSuggestions(totalCents).map((c) => (
                    <button
                      key={c}
                      onClick={() => setReceivedEur((c / 100).toFixed(2))}
                      className="rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm font-medium text-ink-200 hover:bg-ink-800"
                    >
                      {formatEur(c)}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex justify-between text-lg font-bold">
                  <span className="text-ink-300">Výdavok</span>
                  <span
                    className={`tabular-nums ${
                      changeCents < 0 ? 'text-red-400' : 'text-accent'
                    }`}
                  >
                    {formatEur(Math.max(0, changeCents))}
                  </span>
                </div>
                {changeCents < 0 && (
                  <p className="mt-1 text-right text-xs text-red-400">
                    Chýba {formatEur(-changeCents)}
                  </p>
                )}
              </div>
            )}

            {/* Optional buyer e-mail */}
            <div className="mt-4">
              <label className="block text-sm text-ink-300">
                E-mail kupujúceho (voliteľné) — pošleme vstupenky
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="napr. jozko@example.sk"
                  className={`mt-1 w-full rounded-md border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-100 ${
                    emailOk ? '' : 'border-red-400'
                  }`}
                />
              </label>
            </div>

            {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

            <button
              onClick={complete}
              disabled={!canComplete}
              className="mt-5 w-full rounded-lg bg-accent px-4 py-4 text-lg font-semibold text-ink-950 hover:bg-accent-dim disabled:opacity-40"
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
      <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-accent/15 text-3xl text-accent">
        ✓
      </div>
      <h2 className="text-xl font-bold">Predaj dokončený</h2>
      <p className="mt-1 text-sm text-ink-400">
        Vstupenky sú vygenerované. Vytlačte doklad a vstupenky, alebo začnite
        nový predaj.
      </p>
      <div className="mt-6 space-y-3">
        <a
          href={`/pos-receipt/${orderId}`}
          target="_blank"
          rel="noreferrer"
          className="block w-full rounded-lg bg-accent px-4 py-4 text-lg font-semibold text-ink-950 hover:bg-accent-dim"
        >
          🖨 Vytlačiť doklad a vstupenky
        </a>
        <button
          onClick={onCompleted}
          className="block w-full rounded-lg border border-ink-700 px-4 py-3 text-base font-medium text-ink-200 hover:bg-ink-800"
        >
          Nový predaj
        </button>
      </div>
    </div>
  )
}
