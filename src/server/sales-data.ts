/**
 * Sales snapshot builder. Pure server logic: imports only the service client and
 * types — no cookie/auth imports and no client components import it — so it can be
 * used from both the sales server fn and the CSV route without pulling protected
 * server-only modules into the client bundle.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { readAllRows } from './db-paging'
import type { OrderStatus, PaymentMethod } from '../lib/db-types'
import { computeRealizedRevenue, isRealizedOrder } from './realized-revenue'

export interface SalesOrder {
  id: string
  ref: string
  created_at: string
  buyer_email: string
  buyer_name: string | null
  status: OrderStatus
  total_cents: number
  itemsLabel: string
  paymentMethod: PaymentMethod
}

export interface SalesData {
  event: { id: string; title: string; slug: string; timezone: string }
  orders: SalesOrder[]
  totals: {
    grossCents: number
    feeCents: number
    /** Money returned to buyers (non-failed refunds). */
    refundedCents: number
    /** gross − fee − refunded. */
    netCents: number
    paidOrderCount: number
    /** Tickets issued (excluding cancelled) and how many are already admitted. */
    ticketCount: number
    checkedIn: number
  }
  perType: { name: string; soldQty: number; capacity: number }[]
}

interface RawSalesOrder {
  id: string
  created_at: string
  buyer_email: string
  buyer_name: string | null
  status: OrderStatus
  total_cents: number
  fee_cents: number
  payment_method: PaymentMethod
  order_items: {
    quantity: number
    ticket_type_id: string
    ticket_types: { name: string } | null
  }[]
}

/**
 * Sales snapshot for one event, scoped to the caller's organizer. Returns null if
 * the event does not exist under that organizer (caller maps this to 403/404).
 * Totals cover realized revenue (paid orders only); the orders list carries every
 * order for client-side status filtering.
 */
export async function buildSalesData(
  eventId: string,
  organizerId: string,
): Promise<SalesData | null> {
  const db = serviceClient()

  const { data: event } = await db
    .from('events')
    .select('id, title, slug, timezone')
    .eq('id', eventId)
    .eq('organizer_id', organizerId)
    .maybeSingle<{
      id: string
      title: string
      slug: string
      timezone: string
    }>()
  if (!event) return null

  // Paged: this feeds both the sales screen and its CSV export, and the totals
  // below are summed from these rows — a capped read understates the revenue as
  // well as dropping orders off the end of the file.
  //
  // Ordered by id, not created_at: paging needs a unique key or rows repeat and
  // vanish across page boundaries. The display order is restored afterwards.
  const rawOrders = await readAllRows<RawSalesOrder>(
    () =>
      db
        .from('orders')
        .select(
          'id, created_at, buyer_email, buyer_name, status, total_cents, fee_cents, payment_method, order_items(quantity, ticket_type_id, ticket_types(name))',
        )
        .eq('event_id', eventId)
        .order('id', { ascending: true })
        .returns<RawSalesOrder[]>(),
    'objednávky podujatia',
  )
  rawOrders.sort((a, b) => b.created_at.localeCompare(a.created_at))

  const { data: types } = await db
    .from('ticket_types')
    .select('id, name, capacity, sort_order')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true })
    .returns<
      { id: string; name: string; capacity: number; sort_order: number }[]
    >()

  const orders: SalesOrder[] = rawOrders.map((o) => ({
    id: o.id,
    ref: o.id.slice(0, 8).toUpperCase(),
    created_at: o.created_at,
    buyer_email: o.buyer_email,
    buyer_name: o.buyer_name,
    status: o.status,
    total_cents: o.total_cents,
    paymentMethod: o.payment_method,
    itemsLabel: o.order_items
      .map((i) => `${i.quantity}× ${i.ticket_types?.name ?? '—'}`)
      .join(', '),
  }))

  // Refund ledger for this event — nets into the realized totals below, so it is
  // paged for the same reason the orders are: a short read here inflates revenue.
  const refundRows = await readAllRows<{
    amount_cents: number
    status: string
  }>(
    () =>
      db
        .from('refunds')
        .select('amount_cents, status')
        .eq('event_id', eventId)
        .order('id', { ascending: true })
        .returns<{ amount_cents: number; status: string }[]>(),
    'refundácie podujatia',
  )

  const revenue = computeRealizedRevenue(rawOrders, refundRows)

  // "Sold by type" is the gross breakdown over realized orders (money collected);
  // the headline totals net refunds, and the per-type table stays a sales view.
  const soldByType = new Map<string, number>()
  for (const o of rawOrders) {
    if (!isRealizedOrder(o.status)) continue
    for (const i of o.order_items) {
      soldByType.set(
        i.ticket_type_id,
        (soldByType.get(i.ticket_type_id) ?? 0) + i.quantity,
      )
    }
  }

  // Door progress for the same dashboard. Two indexed COUNTs on page load only —
  // the live stream derives these from its own pass, not from here.
  const { count: ticketCount } = (await db
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .neq('status', 'cancelled')) as { count: number | null }
  const { count: checkedIn } = (await db
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'used')) as { count: number | null }

  const perType = (types ?? []).map((t) => ({
    name: t.name,
    soldQty: soldByType.get(t.id) ?? 0,
    capacity: t.capacity,
  }))

  return {
    event,
    orders,
    totals: {
      grossCents: revenue.grossCents,
      feeCents: revenue.feeCents,
      refundedCents: revenue.refundedCents,
      netCents: revenue.netCents,
      paidOrderCount: revenue.orderCount,
      ticketCount: ticketCount ?? 0,
      checkedIn: checkedIn ?? 0,
    },
    perType,
  }
}
