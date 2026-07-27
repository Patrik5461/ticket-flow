/**
 * Live sales snapshot — the numbers the sales dashboard shows, cheap enough to
 * recompute every few seconds.
 *
 * Pure server logic (service client + types only, no cookie/auth imports), so
 * both the SSE stream and the polling server fn can use it.
 *
 * Lighter than buildSalesData: it reads the event's orders (amounts, timestamps
 * and item quantities) plus two head-count queries, and derives both the totals
 * and the chart series from that single pass — no per-metric round trips.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import {
  buildDayRangeSeries,
  buildHourlySeries,
  dayKeyIn,
} from '../lib/daily-series'
import type { DatedOrder, SeriesPoint } from '../lib/daily-series'
import {
  computeRealizedRevenue,
  isRealizedOrder,
  refundCounts,
} from './realized-revenue'
import type { OrderStatus } from '../lib/db-types'

export interface SalesSnapshot {
  /** Money collected (paid + refunded orders' original totals), in cents. */
  grossCents: number
  feeCents: number
  /** Money returned to buyers (non-failed refunds). */
  refundedCents: number
  /** Organizer's realized net: gross − fee − refunded. */
  netCents: number
  paidOrderCount: number
  /** Tickets issued (excluding cancelled) and how many are already admitted. */
  ticketCount: number
  checkedIn: number
  /** When this snapshot was taken (server clock, ISO). */
  at: string
  /** Sales over time, in the EVENT's timezone (see lib/daily-series). */
  series: {
    /** The event day, hour by hour (23-25 buckets across a DST change). */
    hourly: SeriesPoint[]
    /** The pre-sale period, day by day (capped at 120 days). */
    daily: SeriesPoint[]
    /** Local date of the event day, e.g. '2026-07-20'. */
    eventDay: string
    timezone: string
  }
}

/** Structural subset of the Supabase client used here (fakes in tests). */
export interface SalesLiveDb {
  from: (table: string) => any
}

interface OrderAmounts {
  id: string
  status: OrderStatus
  total_cents: number
  fee_cents: number
  created_at: string
  paid_at: string | null
  order_items: { quantity: number }[] | null
}

interface RefundRow {
  order_id: string
  ticket_id: string | null
  amount_cents: number
  status: string
  created_at: string
}

/**
 * Snapshot for one event, scoped to the caller's organizer. Returns null when
 * the event does not belong to that organizer — the same ownership predicate
 * buildSalesData uses, so a foreign event can never stream.
 */
export async function loadSalesSnapshot(
  eventId: string,
  organizerId: string,
  db: SalesLiveDb = serviceClient(),
  now: () => string = () => new Date().toISOString(),
): Promise<SalesSnapshot | null> {
  const { data: event } = (await db
    .from('events')
    .select('id, starts_at, timezone')
    .eq('id', eventId)
    .eq('organizer_id', organizerId)
    .maybeSingle()) as {
    data: { id: string; starts_at: string; timezone: string } | null
  }
  if (!event) return null

  // One pass over the event's orders feeds both the totals and the chart, so the
  // tick stays two small queries. order_items(quantity) makes "tickets sold"
  // available without a round trip; refunds are netted below.
  const { data: orders } = (await db
    .from('orders')
    .select(
      'id, status, total_cents, fee_cents, created_at, paid_at, order_items(quantity)',
    )
    .eq('event_id', eventId)) as { data: OrderAmounts[] | null }

  const { data: refundRows } = (await db
    .from('refunds')
    .select('order_id, ticket_id, amount_cents, status, created_at')
    .eq('event_id', eventId)) as { data: RefundRow[] | null }

  const orderList = orders ?? []
  const refunds = refundRows ?? []

  const revenue = computeRealizedRevenue(orderList, refunds)

  // Tickets a whole-order refund cancels: the order's total item quantity (a
  // whole-order refund cancels every remaining ticket). Used to net the chart's
  // "tickets" line at refund time.
  const ticketsPerOrder = new Map<string, number>()
  const realized: DatedOrder[] = []
  for (const o of orderList) {
    const orderTickets = (o.order_items ?? []).reduce((n, i) => n + i.quantity, 0)
    ticketsPerOrder.set(o.id, orderTickets)
    if (!isRealizedOrder(o.status)) continue
    realized.push({
      total_cents: o.total_cents,
      created_at: o.created_at,
      paid_at: o.paid_at,
      tickets: orderTickets,
    })
  }

  // Each non-failed refund is a NEGATIVE entry bucketed at the moment the money
  // moved (refund.created_at), so both the money and the tickets lines drop at
  // the refund's day/hour — consistent with the settlement view.
  const refundEntries: DatedOrder[] = []
  for (const r of refunds) {
    if (!refundCounts(r.status)) continue
    const tickets = r.ticket_id ? 1 : (ticketsPerOrder.get(r.order_id) ?? 0)
    refundEntries.push({
      total_cents: -r.amount_cents,
      created_at: r.created_at,
      paid_at: r.created_at,
      tickets: -tickets,
    })
  }
  const movements = [...realized, ...refundEntries]

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

  const tz = event.timezone
  const nowMs = Date.parse(now())
  const eventDay = dayKeyIn(new Date(event.starts_at), tz)
  const today = dayKeyIn(new Date(nowMs), tz)

  // Pre-sale axis spans every money movement — sales and refunds alike — from the
  // first to the last, so a refund after the event still shows on the chart.
  const movementDays = movements.map((m) =>
    dayKeyIn(new Date(m.paid_at ?? m.created_at), tz),
  )
  const firstDay = movementDays.length
    ? movementDays.reduce((a, b) => (a < b ? a : b))
    : eventDay
  // End at the later of "when sales normally stop" (event day, or today if still
  // selling) and the last refund day.
  const saleEnd = eventDay < today ? eventDay : today
  const lastMovementDay = movementDays.length
    ? movementDays.reduce((a, b) => (a > b ? a : b))
    : saleEnd
  const lastDay = lastMovementDay > saleEnd ? lastMovementDay : saleEnd

  return {
    grossCents: revenue.grossCents,
    feeCents: revenue.feeCents,
    refundedCents: revenue.refundedCents,
    netCents: revenue.netCents,
    paidOrderCount: revenue.orderCount,
    ticketCount: ticketCount ?? 0,
    checkedIn: checkedIn ?? 0,
    at: now(),
    series: {
      hourly: buildHourlySeries(movements, eventDay, tz),
      daily: buildDayRangeSeries(
        movements,
        firstDay < lastDay ? firstDay : lastDay,
        lastDay,
        tz,
      ),
      eventDay,
      timezone: tz,
    },
  }
}

/**
 * Change key for a snapshot — everything except the timestamp. The stream only
 * pushes when this changes, so an idle event costs one query per tick and zero
 * bytes on the wire.
 */
export function snapshotSignature(s: SalesSnapshot): string {
  return [
    s.grossCents,
    s.feeCents,
    s.refundedCents,
    s.paidOrderCount,
    s.ticketCount,
    s.checkedIn,
  ].join(':')
}
