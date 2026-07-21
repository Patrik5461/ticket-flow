/**
 * Live sales snapshot — the numbers the sales dashboard shows, cheap enough to
 * recompute every few seconds.
 *
 * Pure server logic (service client + types only, no cookie/auth imports), so
 * both the SSE stream and the polling server fn can use it.
 *
 * Deliberately lighter than buildSalesData: it reads three narrow columns of the
 * event's orders plus two head-count queries, instead of the full order list
 * with items. That keeps a 4-second poll affordable even for a busy event.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
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
}

/** Structural subset of the Supabase client used here (fakes in tests). */
export interface SalesLiveDb {
  from: (table: string) => any
}

interface OrderAmounts {
  status: OrderStatus
  total_cents: number
  fee_cents: number
}

const PAID_STATUSES: OrderStatus[] = ['paid', 'partially_refunded']

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
    .select('id')
    .eq('id', eventId)
    .eq('organizer_id', organizerId)
    .maybeSingle()) as { data: { id: string } | null }
  if (!event) return null

  const { data: orders } = (await db
    .from('orders')
    .select('status, total_cents, fee_cents')
    .eq('event_id', eventId)) as { data: OrderAmounts[] | null }

  let grossCents = 0
  let feeCents = 0
  let paidOrderCount = 0
  for (const o of orders ?? []) {
    if (!PAID_STATUSES.includes(o.status)) continue
    grossCents += o.total_cents
    feeCents += o.fee_cents
    paidOrderCount += 1
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

  return {
    grossCents,
    feeCents,
    netCents: grossCents - feeCents,
    paidOrderCount,
    ticketCount: ticketCount ?? 0,
    checkedIn: checkedIn ?? 0,
    at: now(),
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
