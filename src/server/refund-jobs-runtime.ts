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
import { refundPayment } from '../lib/gopay'
import { formatEur } from '../lib/money'
import { refundWholeOrder } from './refund-service'
import type { RefundDeps } from './refund-service'
import type { RefundJobsDeps } from './refund-jobs'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

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
      const html = `
        <h2>Podujatie bolo zrušené</h2>
        <p>Podujatie <strong>${escapeHtml(m.eventTitle)}</strong> bolo zrušené a vašu platbu vám vraciame v plnej výške.</p>
        <p>Objednávka ${m.orderRef}<br/>Refundovaná suma: <strong>${formatEur(m.amountCents)}</strong></p>
        <p style="color:#666;font-size:12px">Peniaze sa vrátia na pôvodný platobný prostriedok, spracovanie môže trvať niekoľko dní.</p>`
      await getEmailProvider().send({
        to: m.to,
        subject: `Podujatie zrušené — ${m.eventTitle}`,
        html,
      })
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
