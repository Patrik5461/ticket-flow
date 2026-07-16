/**
 * Refund server fns: order-detail loader + full/partial refund actions. Callable
 * from both the organizer sales UI and the platform-admin order UI — authorization
 * allows an owner/admin of the event's organizer OR a platform admin.
 *
 * Exports only server fns (+ types); the handlers' getCurrentUser / admin.ts
 * imports are stripped from the client bundle by the createServerFn bridge.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getCurrentUser } from '../lib/supabase/auth'
import { isImpersonating } from './impersonation-session'
import { serviceClient } from '../lib/supabase/server'
import { getEmailProvider } from '../lib/email'
import { refundEmail } from '../lib/email/templates'
import { refundPayment } from '../lib/gopay'
import { writeAuditLog } from './admin'
import {
  refundWholeOrder,
  refundSingleTicket,
  RefundError,
} from './refund-service'
import type { RefundDeps, RefundResult } from './refund-service'
import { formatEur } from '../lib/money'
import type { OrderStatus, TicketStatus } from '../lib/db-types'

// --- shared plumbing ---------------------------------------------------------

async function run<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof RefundError) return { error: e.message }
    throw e
  }
}

/** Authorize the caller for refunds on `eventId`; returns the actor's user id. */
async function requireRefundActor(eventId: string): Promise<string> {
  const user = await getCurrentUser()
  if (!user) throw new RefundError('Neprihlásený.')
  if (await isImpersonating(user)) {
    throw new RefundError(
      'Režim čítania (prezeranie ako organizátor) — zmeny nie sú povolené.',
    )
  }
  const db = serviceClient()

  const { data: admin } = await db
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle<{ user_id: string }>()
  if (admin) return user.id

  const { data: ev } = await db
    .from('events')
    .select('organizer_id')
    .eq('id', eventId)
    .maybeSingle<{ organizer_id: string }>()
  if (!ev) throw new RefundError('Podujatie sa nenašlo.')

  const { data: mem } = await db
    .from('organizer_members')
    .select('role')
    .eq('organizer_id', ev.organizer_id)
    .eq('user_id', user.id)
    .maybeSingle<{ role: string }>()
  if (mem && (mem.role === 'owner' || mem.role === 'admin')) return user.id

  throw new RefundError('Na túto akciu nemáte oprávnenie.')
}

async function eventIdOfOrder(orderId: string): Promise<string> {
  const { data } = await serviceClient()
    .from('orders')
    .select('event_id')
    .eq('id', orderId)
    .maybeSingle<{ event_id: string }>()
  if (!data) throw new RefundError('Objednávka sa nenašla.')
  return data.event_id
}

async function eventIdOfTicket(ticketId: string): Promise<string> {
  const { data } = await serviceClient()
    .from('tickets')
    .select('event_id')
    .eq('id', ticketId)
    .maybeSingle<{ event_id: string }>()
  if (!data) throw new RefundError('Vstupenka sa nenašla.')
  return data.event_id
}

function realDeps(): RefundDeps {
  return {
    db: serviceClient(),
    gopay: {
      refund: async (paymentId, amountCents) => {
        const res = await refundPayment(paymentId, amountCents)
        return { id: String(res.id) }
      },
    },
    sendRefundEmail: async (m) => {
      const { subject, html } = refundEmail({
        eventTitle: m.eventTitle,
        orderRef: m.orderRef,
        amountLabel: formatEur(m.amountCents),
        full: m.full,
      })
      await getEmailProvider().send({ to: m.to, subject, html })
    },
    writeAudit: async (a) => {
      await writeAuditLog({
        actorId: a.actorId,
        action: a.action,
        entityType: 'order',
        entityId: a.orderId,
        oldValue: { status: a.oldStatus },
        newValue: { status: a.newStatus, refunded_cents: a.amountCents },
      })
    },
    now: () => new Date().toISOString(),
  }
}

// --- order detail for the refund UI ------------------------------------------

export interface RefundTicket {
  id: string
  ref: string
  typeName: string
  status: TicketStatus
  unitPriceCents: number
  holderName: string | null
}

export interface RefundRecord {
  id: string
  amountCents: number
  status: string
  ticketId: string | null
  reason: string | null
  createdAt: string
  actorEmail: string | null
}

export interface RefundOrderDetail {
  order: {
    id: string
    ref: string
    status: OrderStatus
    buyer_email: string
    buyer_name: string | null
    subtotal_cents: number
    discount_cents: number
    total_cents: number
    fee_cents: number
    gopay_payment_id: string | null
    created_at: string
    paid_at: string | null
  }
  event: {
    id: string
    title: string
    timezone: string
    organizerId: string
    organizerName: string
  }
  tickets: RefundTicket[]
  refunds: RefundRecord[]
  refundedCents: number
  refundableCents: number
}

interface RawEvent {
  id: string
  title: string
  timezone: string
  organizer_id: string
  organizers: { name: string } | null
}

export const getOrderRefundDetailFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<RefundOrderDetail | { error: string }> => {
    return run(async () => {
      await requireRefundActor(await eventIdOfOrder(data.orderId))
      const db = serviceClient()

      const { data: order } = await db
        .from('orders')
        .select('*')
        .eq('id', data.orderId)
        .maybeSingle<{
          id: string
          event_id: string
          status: OrderStatus
          buyer_email: string
          buyer_name: string | null
          subtotal_cents: number
          discount_cents: number
          total_cents: number
          fee_cents: number
          gopay_payment_id: string | null
          created_at: string
          paid_at: string | null
        }>()
      if (!order) throw new RefundError('Objednávka sa nenašla.')

      const [
        { data: event },
        { data: items },
        { data: ticketRows },
        { data: refundRows },
      ] = await Promise.all([
        db
          .from('events')
          .select('id, title, timezone, organizer_id, organizers(name)')
          .eq('id', order.event_id)
          .maybeSingle<RawEvent>(),
        db
          .from('order_items')
          .select('ticket_type_id, unit_price_cents, ticket_types(name)')
          .eq('order_id', order.id)
          .returns<
            {
              ticket_type_id: string
              unit_price_cents: number
              ticket_types: { name: string } | null
            }[]
          >(),
        db
          .from('tickets')
          .select('id, ticket_type_id, status, holder_name')
          .eq('order_id', order.id)
          .order('created_at', { ascending: true })
          .returns<
            {
              id: string
              ticket_type_id: string
              status: TicketStatus
              holder_name: string | null
            }[]
          >(),
        db
          .from('refunds')
          .select(
            'id, amount_cents, status, ticket_id, reason, created_at, created_by',
          )
          .eq('order_id', order.id)
          .order('created_at', { ascending: false })
          .returns<
            {
              id: string
              amount_cents: number
              status: string
              ticket_id: string | null
              reason: string | null
              created_at: string
              created_by: string | null
            }[]
          >(),
      ])

      const priceByType = new Map<string, number>()
      const nameByType = new Map<string, string>()
      for (const i of items ?? []) {
        priceByType.set(i.ticket_type_id, i.unit_price_cents)
        nameByType.set(i.ticket_type_id, i.ticket_types?.name ?? '—')
      }

      const tickets: RefundTicket[] = (ticketRows ?? []).map((t) => ({
        id: t.id,
        ref: t.id.slice(0, 8).toUpperCase(),
        holderName: t.holder_name,
        typeName: nameByType.get(t.ticket_type_id) ?? '—',
        status: t.status,
        unitPriceCents: priceByType.get(t.ticket_type_id) ?? 0,
      }))

      // Resolve actor emails for the refund history (distinct ids only).
      const rows = refundRows ?? []
      const ids = [
        ...new Set(rows.map((r) => r.created_by).filter(Boolean)),
      ] as string[]
      const emailById = new Map<string, string | null>()
      for (const id of ids) {
        const { data: u } = await db.auth.admin.getUserById(id)
        emailById.set(id, u.user?.email ?? null)
      }

      const refunds: RefundRecord[] = rows.map((r) => ({
        id: r.id,
        amountCents: r.amount_cents,
        status: r.status,
        ticketId: r.ticket_id,
        reason: r.reason,
        createdAt: r.created_at,
        actorEmail: r.created_by ? (emailById.get(r.created_by) ?? null) : null,
      }))

      const refundedCents = rows
        .filter((r) => r.status !== 'failed')
        .reduce((s, r) => s + r.amount_cents, 0)
      const refundableCents =
        order.status === 'paid' || order.status === 'partially_refunded'
          ? Math.max(0, order.total_cents - refundedCents)
          : 0

      return {
        order: {
          id: order.id,
          ref: order.id.slice(0, 8).toUpperCase(),
          status: order.status,
          buyer_email: order.buyer_email,
          buyer_name: order.buyer_name,
          subtotal_cents: order.subtotal_cents,
          discount_cents: order.discount_cents,
          total_cents: order.total_cents,
          fee_cents: order.fee_cents,
          gopay_payment_id: order.gopay_payment_id,
          created_at: order.created_at,
          paid_at: order.paid_at,
        },
        event: {
          id: event?.id ?? order.event_id,
          title: event?.title ?? '—',
          timezone: event?.timezone ?? 'Europe/Bratislava',
          organizerId: event?.organizer_id ?? '',
          organizerName: event?.organizers?.name ?? '—',
        },
        tickets,
        refunds,
        refundedCents,
        refundableCents,
      }
    })
  })

// --- refund actions ----------------------------------------------------------

export const refundOrderFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
        reason: z.string().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<RefundResult | { error: string }> => {
    return run(async () => {
      const actorId = await requireRefundActor(
        await eventIdOfOrder(data.orderId),
      )
      return refundWholeOrder(realDeps(), {
        orderId: data.orderId,
        actorId,
        reason: data.reason ?? null,
      })
    })
  })

export const refundTicketFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        ticketId: z.string().uuid(),
        reason: z.string().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<RefundResult | { error: string }> => {
    return run(async () => {
      const actorId = await requireRefundActor(
        await eventIdOfTicket(data.ticketId),
      )
      return refundSingleTicket(realDeps(), {
        ticketId: data.ticketId,
        actorId,
        reason: data.reason ?? null,
      })
    })
  })
