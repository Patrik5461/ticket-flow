import { createFileRoute } from '@tanstack/react-router'
import { getTicketPdf } from '../server/order-service'

/**
 * Ticket PDF download. Authorized by the same signed order token used on the
 * order page (?t=...). Server-generated PDF (pdf-lib) — no client PDF libs.
 */
export const Route = createFileRoute('/api/orders/$orderId/tickets/$ticketId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const token = new URL(request.url).searchParams.get('t') ?? ''
        const pdf = await getTicketPdf(params.orderId, params.ticketId, token)
        if (!pdf) {
          return new Response('Neplatný odkaz.', { status: 403 })
        }
        // Uint8Array is a valid body at runtime (undici); cast past the strict DOM BodyInit type.
        return new Response(pdf.bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${pdf.filename}"`,
            'Cache-Control': 'private, no-store',
          },
        })
      },
    },
  },
})
