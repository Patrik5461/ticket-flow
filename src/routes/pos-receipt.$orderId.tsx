import { createFileRoute, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import { getPosReceiptFn } from '../server/pos'
import { formatEur } from '../lib/money'
import { formatSk } from '../lib/datetime'
import {
  PRINT_FORMATS,
  PRINT_FORMAT_LIST,
  printCss,
} from '../lib/print-formats'
import type { PrintFormatId } from '../lib/print-formats'
import { PrintTicket } from '../components/PrintTicket'
import type { PaymentMethod } from '../lib/db-types'

export const Route = createFileRoute('/pos-receipt/$orderId')({
  loader: async ({ params }) => {
    const res = await getPosReceiptFn({ data: { orderId: params.orderId } })
    if ('error' in res) throw notFound()
    return res
  },
  component: PosReceiptPage,
})

const METHOD_SK: Record<PaymentMethod, string> = {
  gopay: 'Online (GoPay)',
  manual: 'Manuálne',
  cash: 'Hotovosť',
  terminal: 'Kartou (terminál)',
}

function PosReceiptPage() {
  const data = Route.useLoaderData()
  const [formatId, setFormatId] = useState<PrintFormatId>('thermal80')
  const format = PRINT_FORMATS[formatId]

  const fmtDateTime = (iso: string) =>
    formatSk(iso, 'dateTime', data.event.timezone)

  const { event, order, lines, tickets } = data

  return (
    <div className="print-wrap min-h-screen bg-gray-100 py-6">
      <style>{printCss(format)}</style>

      {/* Controls (never printed) */}
      <div className="no-print mx-auto mb-4 flex max-w-md items-center justify-between gap-3 px-4">
        <div className="inline-flex overflow-hidden rounded-lg border bg-white">
          {PRINT_FORMAT_LIST.map((f) => (
            <button
              key={f.id}
              onClick={() => setFormatId(f.id)}
              className={`px-3 py-2 text-sm font-medium ${
                formatId === f.id ? 'bg-indigo-600 text-white' : ''
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          🖨 Tlačiť
        </button>
      </div>

      {/* One admission ticket per page — Zebra label stock. */}
      {format.document === 'tickets' && (
        <div id="print-tickets" className="mx-auto space-y-4">
          {tickets.map((t) => (
            <PrintTicket
              key={t.id}
              format={format}
              orderRef={order.ref}
              ticket={t}
              event={{
                title: event.title,
                venueName: event.venue_name,
                whenLabel: fmtDateTime(event.starts_at),
              }}
            />
          ))}
        </div>
      )}

      {/* Receipt */}
      <div
        id="pos-receipt"
        hidden={format.document !== 'receipt'}
        className={`mx-auto bg-white p-5 text-gray-900 shadow ${
          formatId === 'thermal80' ? 'max-w-[320px] text-sm' : 'max-w-2xl'
        }`}
      >
        <div className="text-center">
          <div className="text-lg font-bold">{event.title}</div>
          {event.venue_name && (
            <div className="text-xs text-gray-600">
              {event.venue_name}
              {event.venue_address ? `, ${event.venue_address}` : ''}
            </div>
          )}
          <div className="text-xs text-gray-600">
            {fmtDateTime(event.starts_at)}
          </div>
        </div>

        <div className="my-3 border-t border-dashed" />

        <div className="text-center text-sm font-semibold">Doklad o predaji</div>
        <div className="mt-1 text-center text-[11px] text-gray-500">
          Toto nie je daňový doklad (eKasa) — potvrdenie o predaji.
        </div>

        <div className="mt-3 space-y-0.5 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-500">Doklad č.</span>
            <span className="font-mono">{order.ref}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Dátum</span>
            <span>{fmtDateTime(order.created_at)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Úhrada</span>
            <span>{METHOD_SK[order.paymentMethod]}</span>
          </div>
          {order.receiptNumber && (
            <div className="flex justify-between">
              <span className="text-gray-500">eKasa č.</span>
              <span className="font-mono">{order.receiptNumber}</span>
            </div>
          )}
          {order.fiscalCode && (
            <div className="flex justify-between">
              <span className="text-gray-500">OKP</span>
              <span className="font-mono break-all">{order.fiscalCode}</span>
            </div>
          )}
        </div>

        <div className="my-3 border-t border-dashed" />

        {/* Line items */}
        <table className="w-full text-xs">
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-0.5">
                  {l.quantity}× {l.name}
                </td>
                <td className="py-0.5 text-right tabular-nums">
                  {formatEur(l.quantity * l.unitPriceCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="my-3 border-t border-dashed" />

        <div className="space-y-0.5 text-xs">
          {order.discountCents > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-gray-500">Medzisúčet</span>
                <span className="tabular-nums">
                  {formatEur(order.subtotalCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Zľava</span>
                <span className="tabular-nums">
                  −{formatEur(order.discountCents)}
                </span>
              </div>
            </>
          )}
          <div className="flex justify-between text-base font-bold">
            <span>Spolu</span>
            <span className="tabular-nums">{formatEur(order.totalCents)}</span>
          </div>
          {order.cashReceivedCents != null && (
            <>
              <div className="flex justify-between pt-1">
                <span className="text-gray-500">Prijaté</span>
                <span className="tabular-nums">
                  {formatEur(order.cashReceivedCents)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Výdavok</span>
                <span className="tabular-nums">
                  {formatEur(order.changeCents ?? 0)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Tickets — the admission QR codes to hand over */}
        <div className="my-3 border-t border-dashed" />
        <div className="text-center text-xs font-semibold text-gray-600">
          Vstupenky ({tickets.length})
        </div>
        <div className="mt-2 space-y-4">
          {tickets.map((t) => (
            <div
              key={t.id}
              className="break-inside-avoid text-center"
              style={{ pageBreakInside: 'avoid' }}
            >
              <img
                src={t.qrDataUrl}
                alt={`QR ${t.ref}`}
                className="mx-auto h-40 w-40"
              />
              <div className="text-sm font-medium">{t.typeName}</div>
              <div className="font-mono text-[11px] text-gray-500">{t.ref}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 text-center text-[10px] text-gray-400">
          ticketio.sk
        </div>
      </div>
    </div>
  )
}
