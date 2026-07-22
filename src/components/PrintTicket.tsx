import { formatEur } from '../lib/money'
import type { PrintFormat } from '../lib/print-formats'

export interface PrintTicketData {
  id: string
  ref: string
  typeName: string
  qrDataUrl: string
  unitPriceCents: number
}

export interface PrintTicketEvent {
  title: string
  venueName: string | null
  /** Already formatted in the event's timezone by the caller. */
  whenLabel: string
}

/**
 * One admission ticket filling exactly one label page (79 × 152 mm on Zebra).
 *
 * The height is fixed, so the layout is built to never overflow: the title is
 * clamped to two lines, the venue to one, and everything below it has a
 * predictable height. `overflow: hidden` on the page is the last-resort guard —
 * spilling onto a second label would waste stock and desynchronise the roll.
 */
export function PrintTicket({
  event,
  ticket,
  orderRef,
  format,
}: {
  event: PrintTicketEvent
  ticket: PrintTicketData
  orderRef: string
  format: PrintFormat
}) {
  return (
    <div
      className="print-ticket mx-auto flex flex-col overflow-hidden bg-white text-gray-900"
      style={{
        width: format.contentWidth,
        height: format.pageHeight,
        padding: format.contentPadding,
        fontSize: format.fontSize,
      }}
      data-testid="print-ticket"
    >
      {/* Header — event identity */}
      <div className="text-center">
        <div
          className="font-bold leading-tight"
          style={{
            fontSize: '13px',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            overflowWrap: 'anywhere',
          }}
          title={event.title}
        >
          {event.title}
        </div>
        <div className="mt-1 leading-tight" style={{ fontSize: '10px' }}>
          {event.whenLabel}
        </div>
        {event.venueName && (
          <div
            className="overflow-hidden text-ellipsis whitespace-nowrap leading-tight text-gray-700"
            style={{ fontSize: '10px' }}
          >
            {event.venueName}
          </div>
        )}
      </div>

      <div className="my-2 border-t border-dashed border-gray-400" />

      {/* Ticket type + price */}
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold"
          style={{ fontSize: '12px' }}
        >
          {ticket.typeName}
        </span>
        <span className="shrink-0 font-bold tabular-nums" style={{ fontSize: '12px' }}>
          {formatEur(ticket.unitPriceCents)}
        </span>
      </div>

      {/*
        QR — the only element that must never shrink below scanner size.
        40 mm is chosen deliberately: the source PNG is 320 px (lib/tickets/
        qr-image), and 40 mm at 203 dpi — the classic Zebra head resolution — is
        exactly 320 dots, so it prints 1:1 with no resampling. It also leaves
        ~1 mm per module, far above the ~0.5 mm a scanner needs.
      */}
      <div className="flex flex-1 items-center justify-center py-2">
        <img
          src={ticket.qrDataUrl}
          alt={`QR ${ticket.ref}`}
          data-testid="print-ticket-qr"
          style={{ width: '40mm', height: '40mm' }}
        />
      </div>

      {/* Footer — what staff and support quote to each other */}
      <div className="text-center leading-tight">
        <div className="font-mono font-semibold" style={{ fontSize: '11px' }}>
          {ticket.ref}
        </div>
        <div className="text-gray-600" style={{ fontSize: '9px' }}>
          Objednávka {orderRef}
        </div>
        <div className="mt-1 text-gray-400" style={{ fontSize: '8px' }}>
          ticketio.sk
        </div>
      </div>
    </div>
  )
}
