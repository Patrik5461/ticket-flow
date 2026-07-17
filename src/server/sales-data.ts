/**
 * Sales snapshot builder. Pure server logic: imports only the service client and
 * types — no cookie/auth imports and no client components import it — so it can be
 * used from both the sales server fn and the CSV route without pulling protected
 * server-only modules into the client bundle.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import type { OrderStatus, PaymentMethod } from '../lib/db-types'

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
    netCents: number
    paidOrderCount: number
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
    .maybeSingle<{ id: string; title: string; slug: string; timezone: string }>()
  if (!event) return null

  const { data: rawOrders } = await db
    .from('orders')
    .select(
      'id, created_at, buyer_email, buyer_name, status, total_cents, fee_cents, payment_method, order_items(quantity, ticket_type_id, ticket_types(name))',
    )
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .returns<RawSalesOrder[]>()

  const { data: types } = await db
    .from('ticket_types')
    .select('id, name, capacity, sort_order')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true })
    .returns<{ id: string; name: string; capacity: number; sort_order: number }[]>()

  const orders: SalesOrder[] = (rawOrders ?? []).map((o) => ({
    id: o.id,
    ref: o.id.slice(0, 8).toUpperCase(),
    created_at: o.created_at,
    buyer_email: o.buyer_email,
    buyer_name: o.buyer_name,
    status: o.status,
    total_cents: o.total_cents,
    paymentMethod: o.payment_method,
    itemsLabel: (o.order_items ?? [])
      .map((i) => `${i.quantity}× ${i.ticket_types?.name ?? '—'}`)
      .join(', '),
  }))

  const soldByType = new Map<string, number>()
  let grossCents = 0
  let feeCents = 0
  let paidOrderCount = 0
  for (const o of rawOrders ?? []) {
    if (o.status !== 'paid') continue
    paidOrderCount++
    grossCents += o.total_cents
    feeCents += o.fee_cents
    for (const i of o.order_items ?? []) {
      soldByType.set(
        i.ticket_type_id,
        (soldByType.get(i.ticket_type_id) ?? 0) + i.quantity,
      )
    }
  }

  const perType = (types ?? []).map((t) => ({
    name: t.name,
    soldQty: soldByType.get(t.id) ?? 0,
    capacity: t.capacity,
  }))

  return {
    event,
    orders,
    totals: { grossCents, feeCents, netCents: grossCents - feeCents, paidOrderCount },
    perType,
  }
}
