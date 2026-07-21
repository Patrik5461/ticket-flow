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
import type { OrderStatus } from '../lib/db-types'

export interface SalesSnapshot {
  /** Realized revenue — paid orders only, in cents. */
  grossCents: number
  feeCents: number
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
  status: OrderStatus
  total_cents: number
  fee_cents: number
  created_at: string
  paid_at: string | null
  order_items: { quantity: number }[] | null
}

/**
 * Realized revenue = paid orders, exactly as buildSalesData (and the page's
 * "Súčty zahŕňajú len zaplatené objednávky" note) define it. The two must agree
 * or the cards would jump the moment the first live snapshot replaces the
 * loader's numbers.
 */
const PAID_STATUSES: OrderStatus[] = ['paid']

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

  // One pass over the event's orders feeds both the totals and the chart, so
  // the tick costs a single query. order_items(quantity) is what makes "tickets
  // sold" available without a second round trip.
  const { data: orders } = (await db
    .from('orders')
    .select(
      'status, total_cents, fee_cents, created_at, paid_at, order_items(quantity)',
    )
    .eq('event_id', eventId)) as { data: OrderAmounts[] | null }

  let grossCents = 0
  let feeCents = 0
  let paidOrderCount = 0
  // Realized revenue only — the chart and the cards must agree.
  const realized: DatedOrder[] = []
  for (const o of orders ?? []) {
    if (!PAID_STATUSES.includes(o.status)) continue
    grossCents += o.total_cents
    feeCents += o.fee_cents
    paidOrderCount += 1
    realized.push({
      total_cents: o.total_cents,
      created_at: o.created_at,
      paid_at: o.paid_at,
      tickets: (o.order_items ?? []).reduce((n, i) => n + i.quantity, 0),
    })
  }

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

  // Pre-sale axis: from the first realized order up to today, or up to the event
  // day once the event is over. Capped inside buildDayRangeSeries.
  const firstOrderDay = realized.length
    ? realized
        .map((o) => dayKeyIn(new Date(o.paid_at ?? o.created_at), tz))
        .reduce((a, b) => (a < b ? a : b))
    : eventDay
  const lastDay = eventDay < today ? eventDay : today

  return {
    grossCents,
    feeCents,
    netCents: grossCents - feeCents,
    paidOrderCount,
    ticketCount: ticketCount ?? 0,
    checkedIn: checkedIn ?? 0,
    at: now(),
    series: {
      hourly: buildHourlySeries(realized, eventDay, tz),
      daily: buildDayRangeSeries(
        realized,
        firstOrderDay < lastDay ? firstOrderDay : lastDay,
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
    s.paidOrderCount,
    s.ticketCount,
    s.checkedIn,
  ].join(':')
}
