import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { getOrderRefundDetailFn } from '../server/refunds'
import { getOrderCheckinFn, undoCheckinFn } from '../server/reentry'
import type { OrderCheckinView } from '../server/reentry'
import { OrderRefundPanel } from '../components/OrderRefundPanel'
import { formatEur } from '../lib/money'
import { formatSk } from '../lib/datetime'
import type { OrderStatus } from '../lib/db-types'

export const Route = createFileRoute('/app/events/$eventId/orders/$orderId')({
  loader: async ({ params }) => {
    const res = await getOrderRefundDetailFn({
      data: { orderId: params.orderId },
    })
    if ('error' in res) throw notFound()
    return res
  },
  component: OrgOrderDetail,
})

const STATUS_SK: Record<OrderStatus, string> = {
  pending: 'Čaká na platbu',
  paid: 'Zaplatené',
  expired: 'Expirované',
  cancelled: 'Zrušené',
  refunded: 'Vrátené',
  partially_refunded: 'Čiastočne vrátené',
}

function OrgOrderDetail() {
  const { eventId } = Route.useParams()
  const detail = Route.useLoaderData()
  const router = useRouter()
  const { order, event } = detail

  const fmt = (iso: string | null) =>
    iso ? formatSk(iso, 'dateTime', event.timezone) : '—'

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          to="/app/events/$eventId/sales"
          params={{ eventId }}
          className="text-sm text-indigo-600 hover:underline"
        >
          ← Späť na predaj
        </Link>
        <h1 className="mt-2 flex items-center gap-3 text-2xl font-bold">
          Objednávka <span className="font-mono">{order.ref}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-sm font-medium text-gray-700">
            {STATUS_SK[order.status]}
          </span>
        </h1>
      </div>

      <section className="rounded-lg border bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
          Kupujúci
        </h2>
        <div className="flex justify-between py-1 text-sm">
          <span className="text-gray-500">E-mail</span>
          <span>{order.buyer_email}</span>
        </div>
        <div className="flex justify-between py-1 text-sm">
          <span className="text-gray-500">Meno</span>
          <span>{order.buyer_name ?? '—'}</span>
        </div>
        <div className="flex justify-between py-1 text-sm">
          <span className="text-gray-500">Vytvorená</span>
          <span>{fmt(order.created_at)}</span>
        </div>
        <div className="mt-3 flex justify-between border-t pt-3 text-sm">
          <span className="text-gray-500">Spolu zaplatené</span>
          <span className="font-bold">{formatEur(order.total_cents)}</span>
        </div>
      </section>

      <OrderCheckinSection
        eventId={eventId}
        orderId={order.id}
        tz={event.timezone}
      />

      <OrderRefundPanel detail={detail} onChanged={() => router.invalidate()} />
    </div>
  )
}

const ENTRY_LABEL: Record<string, string> = {
  ok: 'Vstup',
  reentry: 'Opätovný vstup',
  undo: 'Odčítané',
  already_used: 'Zablokované (už použitá)',
  cancelled: 'Zrušená vstupenka',
  invalid: 'Neplatný kód',
}

const TICKET_STATUS: Record<string, [string, string]> = {
  valid: ['Platná', 'bg-gray-100 text-gray-600'],
  used: ['Odbavená', 'bg-green-100 text-green-700'],
  cancelled: ['Zrušená', 'bg-red-100 text-red-700'],
}

/** Check-in history per ticket + owner/admin-only manual undo. */
function OrderCheckinSection({
  eventId,
  orderId,
  tz,
}: {
  eventId: string
  orderId: string
  tz: string
}) {
  const [view, setView] = useState<OrderCheckinView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    void getOrderCheckinFn({ data: { orderId } }).then((res) => {
      if (!alive) return
      if ('error' in res) setErr(res.error)
      else setView(res)
    })
    return () => {
      alive = false
    }
  }, [orderId, tick])

  const undo = async (ticketId: string) => {
    if (busyId) return
    if (
      !window.confirm(
        'Odčítať check-in tejto vstupenky? Vstupenka sa vráti na platnú a návštevník bude môcť vstúpiť znova.',
      )
    )
      return
    setBusyId(ticketId)
    setErr(null)
    const res = await undoCheckinFn({ data: { ticketId, eventId } })
    setBusyId(null)
    if (!res.ok) {
      setErr(res.error)
      return
    }
    setTick((t) => t + 1)
  }

  if (!view) return null

  return (
    <section className="rounded-lg border bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
        Check-in
      </h2>
      {err && <p className="mb-3 text-sm text-red-600">{err}</p>}
      <div className="space-y-3">
        {view.tickets.map((t) => {
          const [label, cls] = TICKET_STATUS[t.status] ?? [t.status, '']
          return (
            <div key={t.ticketId} className="rounded border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {t.holderName ?? '—'}{' '}
                    <span className="font-mono text-xs text-gray-400">
                      {t.ref}
                    </span>
                  </div>
                  <span
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
                  >
                    {label}
                  </span>
                </div>
                {view.canUndo && t.status === 'used' && (
                  <button
                    type="button"
                    onClick={() => void undo(t.ticketId)}
                    disabled={busyId === t.ticketId}
                    className="shrink-0 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    {busyId === t.ticketId ? 'Odčítavam…' : 'Odčítať check-in'}
                  </button>
                )}
              </div>
              {t.entries.length > 0 && (
                <ul className="mt-2 space-y-1 border-t pt-2 text-sm">
                  {t.entries.map((e, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="text-gray-700">
                        {ENTRY_LABEL[e.result] ?? e.result}
                      </span>
                      <span className="text-right text-gray-400">
                        {formatSk(e.at, 'dateTime', tz)}
                        {e.deviceLabel ? ` · ${e.deviceLabel}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
