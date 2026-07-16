/**
 * Real dependencies for the refund-queue worker: wires refundWholeOrder with the
 * live GoPay client, a cancellation-worded buyer email, and a direct audit_log
 * insert. Deliberately does NOT import admin.ts (which pulls getCurrentUser /
 * @tanstack/react-start/server) so the /api/cron/process-refunds route can import
 * this without dragging a client-protected module into the client bundle.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { getEmailProvider } from '../lib/email'
import { eventCancelledEmail } from '../lib/email/templates'
import { refundPayment } from '../lib/gopay'
import { formatEur } from '../lib/money'
import { refundWholeOrder } from './refund-service'
import type { RefundDeps } from './refund-service'
import type { RefundJobsDeps } from './refund-jobs'

/** Refund deps whose buyer email is worded for an event cancellation. */
function cancellationRefundDeps(): RefundDeps {
  return {
    db: serviceClient(),
    gopay: {
      refund: async (paymentId, amountCents) => {
        const res = await refundPayment(paymentId, amountCents)
        return { id: String(res.id) }
      },
    },
    sendRefundEmail: async (m) => {
      const { subject, html } = eventCancelledEmail({
        eventTitle: m.eventTitle,
        orderRef: m.orderRef,
        amountLabel: formatEur(m.amountCents),
      })
      await getEmailProvider().send({ to: m.to, subject, html })
    },
    writeAudit: async (a) => {
      await serviceClient()
        .from('audit_log')
        .insert({
          actor_id: a.actorId,
          action: a.action,
          entity_type: 'order',
          entity_id: a.orderId,
          old_value: { status: a.oldStatus },
          new_value: { status: a.newStatus, refunded_cents: a.amountCents },
        })
    },
    now: () => new Date().toISOString(),
  }
}

/** Runtime deps for the queue worker: refund each order as a system action. */
export function realJobDeps(): RefundJobsDeps {
  return {
    db: serviceClient(),
    refundOrder: async (orderId) => {
      await refundWholeOrder(cancellationRefundDeps(), {
        orderId,
        actorId: null,
      })
    },
    now: () => new Date().toISOString(),
  }
}
