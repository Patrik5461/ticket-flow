/**
 * Organizer-side support request management (e-mail change). Guarded by
 * requireEventManager (owner/admin of the event's organizer, or platform admin;
 * blocked during read-only impersonation). On approval of an e-mail change the
 * order's buyer_email is updated and the tickets are resent to the new address
 * (reusing the Phase 8 sender). Audited.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requireEventManager, EventAuthzError } from './event-authz'
import { writeAuditLog } from './admin'
import { sendSingleTicketEmail } from './ticket-email'
import { orderRef } from '../lib/order-ref'

export interface SupportRequestView {
  id: string
  orderRef: string
  kind: string
  requestedEmail: string
  newEmail: string | null
  status: 'pending' | 'approved' | 'rejected'
  note: string | null
  createdAt: string
  resolvedAt: string | null
}

async function run<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof EventAuthzError) return { error: e.message }
    throw e
  }
}

export const listSupportRequestsFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(
    async ({ data }): Promise<SupportRequestView[] | { error: string }> => {
      return run(async () => {
        await requireEventManager(data.eventId)
        const { data: rows } = await serviceClient()
          .from('support_requests')
          .select(
            'id, order_id, kind, requested_email, new_email, status, note, created_at, resolved_at, orders(id)',
          )
          .eq('event_id', data.eventId)
          .order('created_at', { ascending: false })
          .returns<
            {
              id: string
              order_id: string
              kind: string
              requested_email: string
              new_email: string | null
              status: SupportRequestView['status']
              note: string | null
              created_at: string
              resolved_at: string | null
            }[]
          >()
        return (rows ?? []).map((r) => ({
          id: r.id,
          orderRef: orderRef(r.order_id),
          kind: r.kind,
          requestedEmail: r.requested_email,
          newEmail: r.new_email,
          status: r.status,
          note: r.note,
          createdAt: r.created_at,
          resolvedAt: r.resolved_at,
        }))
      })
    },
  )

export const resolveSupportRequestFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(['approve', 'reject']),
        note: z.string().trim().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return run(async () => {
      const db = serviceClient()
      const { data: req } = await db
        .from('support_requests')
        .select('id, order_id, event_id, kind, new_email, status')
        .eq('id', data.id)
        .maybeSingle<{
          id: string
          order_id: string
          event_id: string
          kind: string
          new_email: string | null
          status: string
        }>()
      if (!req) throw new EventAuthzError('Požiadavka sa nenašla.')

      const actorId = await requireEventManager(req.event_id)
      if (req.status !== 'pending') {
        return { error: 'Požiadavka už bola vybavená.' }
      }

      if (data.action === 'approve' && req.kind === 'email_change') {
        if (!req.new_email) return { error: 'Chýba nový e-mail.' }
        // Update the order's buyer e-mail, then resend tickets to it.
        await db
          .from('orders')
          .update({ buyer_email: req.new_email })
          .eq('id', req.order_id)
        const { data: tickets } = await db
          .from('tickets')
          .select('id')
          .eq('order_id', req.order_id)
          .neq('status', 'cancelled')
          .returns<{ id: string }[]>()
        for (const t of tickets ?? []) {
          await sendSingleTicketEmail(t.id, req.new_email)
        }
      }

      await db
        .from('support_requests')
        .update({
          status: data.action === 'approve' ? 'approved' : 'rejected',
          note: data.note || null,
          resolved_by: actorId,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', req.id)

      await writeAuditLog({
        actorId,
        action:
          data.action === 'approve'
            ? 'support.email_change_approved'
            : 'support.email_change_rejected',
        entityType: 'order',
        entityId: req.order_id,
        newValue: { new_email: req.new_email },
      }).catch(() => undefined)

      return { ok: true as const }
    })
  })
