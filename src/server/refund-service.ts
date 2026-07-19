/**
 * Refund orchestration: full-order and single-ticket refunds. Pure of framework
 * concerns — all side effects (DB, GoPay, email, audit) are injected via `deps`,
 * so the flow is unit-testable with fakes. The server fns in refunds.ts wire the
 * real implementations.
 *
 * Server-only.
 */

import { ticketRefundCents, orderStatusAfterRefund } from '../lib/refunds'
import type { OrderStatus, TicketStatus } from '../lib/db-types'

export class RefundError extends Error {}

export interface RefundGateway {
  /** Refund `amountCents` of a payment; returns the gateway reference. */
  refund: (paymentId: string, amountCents: number) => Promise<{ id: string }>
}

export interface RefundEmail {
  eventTitle: string
  to: string
  orderRef: string
  amountCents: number
  full: boolean
}

export interface RefundAudit {
  actorId: string | null
  action: string
  orderId: string
  oldStatus: OrderStatus
  newStatus: OrderStatus
  amountCents: number
}

export interface RefundDeps {
  db: { from: (t: string) => any; rpc: (fn: string, args: unknown) => any }
  gopay: RefundGateway
  sendRefundEmail: (m: RefundEmail) => Promise<void>
  writeAudit: (a: RefundAudit) => Promise<void>
  now: () => string
}

export interface RefundResult {
  ok: boolean
  refundedCents: number
  orderStatus: OrderStatus
  message?: string
}

interface OrderRow {
  id: string
  event_id: string
  status: OrderStatus
  subtotal_cents: number
  total_cents: number
  gopay_payment_id: string | null
  buyer_email: string
}

interface TicketRow {
  id: string
  ticket_type_id: string
  status: TicketStatus
}

const REFUNDABLE: OrderStatus[] = ['paid', 'partially_refunded']

async function loadOrder(deps: RefundDeps, orderId: string): Promise<OrderRow> {
  const { data } = await deps.db
    .from('orders')
    .select(
      'id, event_id, status, subtotal_cents, total_cents, gopay_payment_id, buyer_email',
    )
    .eq('id', orderId)
    .maybeSingle()
  if (!data) throw new RefundError('Objednávka sa nenašla.')
  return data as OrderRow
}

async function eventTitle(deps: RefundDeps, eventId: string): Promise<string> {
  const { data } = await deps.db
    .from('events')
    .select('title')
    .eq('id', eventId)
    .maybeSingle()
  return (data as { title: string } | null)?.title ?? ''
}

/** Sum of refunds already booked against the order (requested or done). */
async function alreadyRefunded(
  deps: RefundDeps,
  orderId: string,
): Promise<number> {
  const { data } = await deps.db
    .from('refunds')
    .select('amount_cents, status')
    .eq('order_id', orderId)
  return ((data as { amount_cents: number; status: string }[] | null) ?? [])
    .filter((r) => r.status !== 'failed')
    .reduce((s, r) => s + r.amount_cents, 0)
}

async function activeTickets(
  deps: RefundDeps,
  orderId: string,
): Promise<TicketRow[]> {
  const { data } = await deps.db
    .from('tickets')
    .select('id, ticket_type_id, status, event_id, seat_id')
    .eq('order_id', orderId)
    .neq('status', 'cancelled')
  return (data as TicketRow[] | null) ?? []
}

async function cancelTicketReleaseCapacity(
  deps: RefundDeps,
  ticket: {
    id: string
    ticket_type_id: string
    event_id: string
    seat_id: string | null
  },
): Promise<void> {
  await deps.db
    .from('tickets')
    .update({ status: 'cancelled' })
    .eq('id', ticket.id)
  // Numbered seat: free the specific event_seat so it can be resold. The
  // sold_count decrement below (release_ticket_capacity) is correct for both
  // seated and unseated, since a seated claim incremented sold_count by 1.
  if (ticket.seat_id) {
    await deps.db
      .from('event_seats')
      .update({ status: 'available', held_until: null, order_id: null })
      .eq('event_id', ticket.event_id)
      .eq('seat_id', ticket.seat_id)
      .in('status', ['held', 'sold'])
  }
  // Give capacity back. Best-effort — accounting must not block the refund that
  // already went through the gateway.
  await deps.db
    .rpc('release_ticket_capacity', {
      p_ticket_type_id: ticket.ticket_type_id,
      p_qty: 1,
    })
    .then(
      () => undefined,
      () => undefined,
    )
}

/** Book a refund at the gateway (when there is money to return) and record it. */
async function bookRefund(
  deps: RefundDeps,
  order: OrderRow,
  amountCents: number,
  actorId: string | null,
  ticketId: string | null,
  reason: string | null,
): Promise<void> {
  let gopayRefundId: string | null = null
  let status: 'done' | 'failed' = 'done'
  if (amountCents > 0) {
    if (!order.gopay_payment_id) {
      throw new RefundError(
        'Objednávka nemá GoPay platbu — refund cez bránu nie je možný.',
      )
    }
    try {
      const res = await deps.gopay.refund(order.gopay_payment_id, amountCents)
      gopayRefundId = res.id
    } catch (e) {
      status = 'failed'
      await deps.db.from('refunds').insert({
        order_id: order.id,
        ticket_id: ticketId,
        amount_cents: amountCents,
        gopay_refund_id: null,
        status,
        reason,
        created_by: actorId,
      })
      throw new RefundError(
        `Refund cez GoPay zlyhal: ${e instanceof Error ? e.message : 'neznáma chyba'}`,
      )
    }
  }
  await deps.db.from('refunds').insert({
    order_id: order.id,
    ticket_id: ticketId,
    amount_cents: amountCents,
    gopay_refund_id: gopayRefundId,
    status,
    reason,
    created_by: actorId,
  })
}

/** Refund the whole remaining balance of an order and cancel all its tickets. */
export async function refundWholeOrder(
  deps: RefundDeps,
  args: { orderId: string; actorId: string | null; reason?: string | null },
): Promise<RefundResult> {
  const order = await loadOrder(deps, args.orderId)
  if (order.status === 'refunded') {
    return {
      ok: true,
      refundedCents: 0,
      orderStatus: 'refunded',
      message: 'Už plne refundované.',
    }
  }
  if (!REFUNDABLE.includes(order.status)) {
    throw new RefundError('Objednávku v tomto stave nie je možné refundovať.')
  }

  const remaining = order.total_cents - (await alreadyRefunded(deps, order.id))
  const tickets = await activeTickets(deps, order.id)

  if (remaining > 0) {
    await bookRefund(
      deps,
      order,
      remaining,
      args.actorId,
      null,
      args.reason ?? null,
    )
  }

  for (const t of tickets) {
    await cancelTicketReleaseCapacity(deps, {
      id: t.id,
      ticket_type_id: t.ticket_type_id,
      event_id: order.event_id,
      seat_id: (t as TicketRow & { seat_id: string | null }).seat_id ?? null,
    })
  }

  await deps.db.from('orders').update({ status: 'refunded' }).eq('id', order.id)

  await deps.writeAudit({
    actorId: args.actorId,
    action: 'order.refund',
    orderId: order.id,
    oldStatus: order.status,
    newStatus: 'refunded',
    amountCents: Math.max(0, remaining),
  })
  await deps.sendRefundEmail({
    eventTitle: await eventTitle(deps, order.event_id),
    to: order.buyer_email,
    orderRef: order.id.slice(0, 8).toUpperCase(),
    amountCents: Math.max(0, remaining),
    full: true,
  })

  return {
    ok: true,
    refundedCents: Math.max(0, remaining),
    orderStatus: 'refunded',
  }
}

/** Refund a single ticket (its share of the paid total) and cancel it. */
export async function refundSingleTicket(
  deps: RefundDeps,
  args: { ticketId: string; actorId: string | null; reason?: string | null },
): Promise<RefundResult> {
  const { data: ticket } = await deps.db
    .from('tickets')
    .select('id, order_id, ticket_type_id, status, event_id, seat_id')
    .eq('id', args.ticketId)
    .maybeSingle()
  if (!ticket) throw new RefundError('Vstupenka sa nenašla.')
  const tk = ticket as TicketRow & {
    order_id: string
    event_id: string
    seat_id: string | null
  }
  if (tk.status === 'cancelled') {
    throw new RefundError('Vstupenka je už zrušená.')
  }

  const order = await loadOrder(deps, tk.order_id)
  if (!REFUNDABLE.includes(order.status)) {
    throw new RefundError('Objednávku v tomto stave nie je možné refundovať.')
  }

  const { data: item } = await deps.db
    .from('order_items')
    .select('unit_price_cents')
    .eq('order_id', order.id)
    .eq('ticket_type_id', tk.ticket_type_id)
    .maybeSingle()
  const unitPriceCents =
    (item as { unit_price_cents: number } | null)?.unit_price_cents ?? 0

  const remaining = order.total_cents - (await alreadyRefunded(deps, order.id))
  const amount = ticketRefundCents({
    unitPriceCents,
    subtotalCents: order.subtotal_cents,
    totalCents: order.total_cents,
    remainingCents: remaining,
  })

  if (amount > 0) {
    await bookRefund(
      deps,
      order,
      amount,
      args.actorId,
      tk.id,
      args.reason ?? null,
    )
  } else {
    // €0 ticket (free / nothing left): still record the cancellation as a refund
    // row so history is complete, without a gateway call.
    await deps.db.from('refunds').insert({
      order_id: order.id,
      ticket_id: tk.id,
      amount_cents: 0,
      gopay_refund_id: null,
      status: 'done',
      reason: args.reason ?? null,
      created_by: args.actorId,
    })
  }

  await cancelTicketReleaseCapacity(deps, {
    id: tk.id,
    ticket_type_id: tk.ticket_type_id,
    event_id: tk.event_id,
    seat_id: tk.seat_id,
  })

  const remainingActive = (await activeTickets(deps, order.id)).length
  const newStatus = orderStatusAfterRefund(remainingActive)
  await deps.db.from('orders').update({ status: newStatus }).eq('id', order.id)

  await deps.writeAudit({
    actorId: args.actorId,
    action: 'ticket.refund',
    orderId: order.id,
    oldStatus: order.status,
    newStatus,
    amountCents: amount,
  })
  await deps.sendRefundEmail({
    eventTitle: await eventTitle(deps, order.event_id),
    to: order.buyer_email,
    orderRef: order.id.slice(0, 8).toUpperCase(),
    amountCents: amount,
    full: false,
  })

  return { ok: true, refundedCents: amount, orderStatus: newStatus }
}
