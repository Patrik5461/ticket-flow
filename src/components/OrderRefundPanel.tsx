import { useState } from 'react'
import { refundOrderFn, refundTicketFn } from '../server/refunds'
import type { RefundOrderDetail } from '../server/refunds'
import { formatEur } from '../lib/money'
import type { TicketStatus } from '../lib/db-types'

/**
 * Refund controls for one order — full-order and per-ticket refunds plus the
 * refund history. Shared by the organizer sales UI and the platform-admin order
 * UI; both are backed by the same authorized server fns.
 */

const TICKET_SK: Record<TicketStatus, string> = {
  valid: 'Platná',
  used: 'Použitá',
  cancelled: 'Zrušená',
}
const TICKET_CLS: Record<TicketStatus, string> = {
  valid: 'bg-green-100 text-green-700',
  used: 'bg-indigo-100 text-indigo-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

export function OrderRefundPanel({
  detail,
  onChanged,
}: {
  detail: RefundOrderDetail
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const canRefund = detail.refundableCents > 0
  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat('sk-SK', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: detail.event.timezone,
    }).format(new Date(iso))

  const refundOrder = async () => {
    if (
      !confirm(
        `Refundovať celú zostávajúcu sumu ${formatEur(detail.refundableCents)}? Všetky platné vstupenky sa zrušia.`,
      )
    )
      return
    setBusy('order')
    setErr(null)
    const res = await refundOrderFn({ data: { orderId: detail.order.id } })
    setBusy(null)
    if ('error' in res) setErr(res.error)
    else onChanged()
  }

  const refundTicket = async (ticketId: string) => {
    if (!confirm('Refundovať túto vstupenku a zrušiť ju?')) return
    setBusy(ticketId)
    setErr(null)
    const res = await refundTicketFn({ data: { ticketId } })
    setBusy(null)
    if ('error' in res) setErr(res.error)
    else onChanged()
  }

  return (
    <section className="space-y-4 rounded-lg border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase text-gray-500">
          Refundácie
        </h2>
        <div className="text-sm text-gray-600">
          Refundované: <strong>{formatEur(detail.refundedCents)}</strong> ·
          Možno refundovať: <strong>{formatEur(detail.refundableCents)}</strong>
        </div>
      </div>

      {canRefund && (
        <button
          onClick={refundOrder}
          disabled={busy !== null}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy === 'order'
            ? 'Refundujem…'
            : `Refundovať celú objednávku (${formatEur(detail.refundableCents)})`}
        </button>
      )}
      {!canRefund && (
        <p className="text-sm text-gray-500">
          Túto objednávku už nie je možné refundovať.
        </p>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* Per-ticket */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase text-gray-400">
          Vstupenky
        </h3>
        <table className="w-full text-sm">
          <tbody>
            {detail.tickets.map((t) => (
              <tr key={t.id} className="border-t first:border-t-0">
                <td className="py-2 font-mono text-xs">{t.ref}</td>
                <td className="py-2">{t.typeName}</td>
                <td className="py-2 text-right tabular-nums text-gray-500">
                  {formatEur(t.unitPriceCents)}
                </td>
                <td className="py-2 text-center">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${TICKET_CLS[t.status]}`}
                  >
                    {TICKET_SK[t.status]}
                  </span>
                </td>
                <td className="py-2 text-right">
                  {t.status !== 'cancelled' && canRefund && (
                    <button
                      onClick={() => refundTicket(t.id)}
                      disabled={busy !== null}
                      className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {busy === t.id ? '…' : 'Refundovať'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* History */}
      {detail.refunds.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-gray-400">
            História refundácií
          </h3>
          <ul className="space-y-2 text-sm">
            {detail.refunds.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap justify-between gap-2 border-t pt-2 first:border-t-0 first:pt-0"
              >
                <span>
                  <strong>{formatEur(r.amountCents)}</strong>
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                      r.status === 'done'
                        ? 'bg-green-100 text-green-700'
                        : r.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {r.status}
                  </span>
                  {r.ticketId && (
                    <span className="ml-2 text-xs text-gray-400">
                      (vstupenka {r.ticketId.slice(0, 8).toUpperCase()})
                    </span>
                  )}
                </span>
                <span className="text-xs text-gray-400">
                  {r.actorEmail ?? 'systém'} · {fmtTime(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
