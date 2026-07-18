/**
 * Public support server fns for the AI assistant / anonymous buyer. Security is
 * enforced HERE, on the server — not in any model prompt:
 *
 *  - Every action requires BOTH the buyer e-mail AND the order ref to match; a
 *    match on only one returns nothing.
 *  - Ticket resend goes ONLY to the order's stored buyer_email, never to an
 *    address supplied in the request.
 *  - An e-mail change creates a pending support_request for the organizer to
 *    approve — it emails nothing.
 *  - Rate limited per IP (anti-enumeration).
 *
 * These are the ONLY capabilities exposed to the assistant.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { clientIpFromHeaders } from '../lib/client-ip'
import { supportLimiter } from './rate-guards'
import { refMatches, maskEmail } from '../lib/order-ref'
import { sendSingleTicketEmail } from './ticket-email'
import { writeAuditLog } from './admin'

interface FoundOrder {
  id: string
  buyer_email: string
  status: string
  paid_at: string | null
  event_id: string
  events: {
    title: string
    starts_at: string
    venue_name: string | null
    timezone: string
  } | null
}

/** Find an order by BOTH email (case-insensitive) and ref, or null. */
async function findOrder(
  email: string,
  ref: string,
): Promise<FoundOrder | null> {
  const clean = email.trim()
  if (!clean || !ref.trim()) return null
  const { data } = await serviceClient()
    .from('orders')
    .select(
      'id, buyer_email, status, paid_at, event_id, events(title, starts_at, venue_name, timezone)',
    )
    .ilike('buyer_email', clean) // exact, case-insensitive (no wildcards)
    .returns<FoundOrder[]>()
  return (data ?? []).find((o) => refMatches(o.id, ref)) ?? null
}

function rateLimited(): boolean {
  const ip = clientIpFromHeaders(getRequest().headers)
  return !supportLimiter.check(ip).ok
}

const lookupSchema = z.object({
  email: z.string().trim().email().max(200),
  orderRef: z.string().trim().min(4).max(40),
})

export interface OrderLookup {
  found: boolean
  order?: {
    ref: string
    status: string
    eventTitle: string
    eventStartsAt: string
    eventVenue: string | null
    timezone: string
    paidAt: string | null
    ticketCount: number
    buyerEmailMasked: string
  }
}

export const lookupOrderFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => lookupSchema.parse(d))
  .handler(async ({ data }): Promise<OrderLookup | { error: string }> => {
    if (rateLimited()) {
      return { error: 'Priveľa pokusov. Skúste o 15 minút.' }
    }
    const order = await findOrder(data.email, data.orderRef)
    if (!order) return { found: false }

    const { count } = await serviceClient()
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('order_id', order.id)
      .neq('status', 'cancelled')

    return {
      found: true,
      order: {
        ref: order.id.slice(0, 8).toUpperCase(),
        status: order.status,
        eventTitle: order.events?.title ?? '—',
        eventStartsAt: order.events?.starts_at ?? '',
        eventVenue: order.events?.venue_name ?? null,
        timezone: order.events?.timezone ?? 'Europe/Bratislava',
        paidAt: order.paid_at,
        ticketCount: count ?? 0,
        buyerEmailMasked: maskEmail(order.buyer_email),
      },
    }
  })

export const resendTicketsFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => lookupSchema.parse(d))
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; sentTo: string } | { ok: false; reason: string }
    > => {
      if (rateLimited()) {
        return { ok: false, reason: 'Priveľa pokusov. Skúste o 15 minút.' }
      }
      const order = await findOrder(data.email, data.orderRef)
      if (!order) {
        return { ok: false, reason: 'Objednávka sa nenašla.' }
      }
      if (order.status !== 'paid' && order.status !== 'partially_refunded') {
        return { ok: false, reason: 'Objednávka nie je zaplatená.' }
      }

      const { data: tickets } = await serviceClient()
        .from('tickets')
        .select('id')
        .eq('order_id', order.id)
        .neq('status', 'cancelled')
        .returns<{ id: string }[]>()
      if (!tickets || tickets.length === 0) {
        return { ok: false, reason: 'K objednávke nie sú žiadne vstupenky.' }
      }

      // ALWAYS to the stored buyer_email — never an address from the request.
      for (const t of tickets) {
        await sendSingleTicketEmail(t.id, order.buyer_email)
      }

      await writeAuditLog({
        actorId: null,
        action: 'support.resend_tickets',
        entityType: 'order',
        entityId: order.id,
        newValue: { count: tickets.length },
      }).catch(() => undefined)

      return { ok: true, sentTo: maskEmail(order.buyer_email) }
    },
  )

const emailChangeSchema = lookupSchema.extend({
  newEmail: z.string().trim().email().max(200),
})

export const requestEmailChangeFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => emailChangeSchema.parse(d))
  .handler(
    async ({ data }): Promise<{ ok: true } | { ok: false; reason: string }> => {
      if (rateLimited()) {
        return { ok: false, reason: 'Priveľa pokusov. Skúste o 15 minút.' }
      }
      const order = await findOrder(data.email, data.orderRef)
      if (!order) return { ok: false, reason: 'Objednávka sa nenašla.' }

      // Create a pending request only — nothing is emailed here.
      const { error } = await serviceClient().from('support_requests').insert({
        order_id: order.id,
        event_id: order.event_id,
        kind: 'email_change',
        requested_email: data.email.trim(),
        new_email: data.newEmail.trim(),
        status: 'pending',
      })
      if (error) return { ok: false, reason: 'Žiadosť sa nepodarilo vytvoriť.' }

      await writeAuditLog({
        actorId: null,
        action: 'support.email_change_requested',
        entityType: 'order',
        entityId: order.id,
        newValue: { new_email: data.newEmail.trim() },
      }).catch(() => undefined)

      return { ok: true }
    },
  )
