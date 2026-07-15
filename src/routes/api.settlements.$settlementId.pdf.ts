import { createFileRoute } from '@tanstack/react-router'
import {
  getUserIdFromRequest,
  organizerIdForUser,
} from '../lib/supabase/auth-request'
import { getSettlementForOrganizer } from '../server/settlement-service'
import { renderSettlementPdf } from '../lib/settlements/pdf'

/**
 * Settlement protocol PDF download. Authorized by session cookie: the settlement
 * must belong to the caller's organizer. Server-generated (pdf-lib).
 */
export const Route = createFileRoute('/api/settlements/$settlementId/pdf')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const userId = await getUserIdFromRequest(request)
        if (!userId) return new Response('Neprihlásený.', { status: 401 })
        const organizerId = await organizerIdForUser(userId)
        if (!organizerId)
          return new Response('Bez organizátora.', { status: 403 })

        const detail = await getSettlementForOrganizer(
          params.settlementId,
          organizerId,
        )
        if (!detail) return new Response('Nenájdené.', { status: 404 })

        const monthFmt = new Intl.DateTimeFormat('sk-SK', {
          month: 'long',
          year: 'numeric',
          timeZone: 'Europe/Bratislava',
        })
        const dtFmt = new Intl.DateTimeFormat('sk-SK', {
          dateStyle: 'short',
          timeZone: 'Europe/Bratislava',
        })

        const bytes = await renderSettlementPdf({
          organizer: detail.organizer,
          periodLabel: monthFmt.format(
            new Date(detail.settlement.period_start),
          ),
          generatedLabel: dtFmt.format(
            new Date(detail.settlement.generated_at),
          ),
          grossCents: detail.settlement.gross_cents,
          feeCents: detail.settlement.fee_cents,
          refundedCents: detail.settlement.refunded_cents,
          netCents: detail.settlement.net_cents,
          orderCount: detail.settlement.order_count,
          lines: detail.orders.map((o) => ({
            ref: o.ref,
            eventTitle: o.eventTitle,
            dateLabel: o.paidAt ? dtFmt.format(new Date(o.paidAt)) : '—',
            totalCents: o.totalCents,
            feeCents: o.feeCents,
            refundedCents: o.refundedCents,
          })),
        })

        return new Response(bytes as unknown as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="vyuctovanie-${detail.settlement.period_month}.pdf"`,
            'Cache-Control': 'private, no-store',
          },
        })
      },
    },
  },
})
