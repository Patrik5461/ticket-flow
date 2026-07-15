/**
 * Settlement reads for the PDF + organizer dashboard. Pure server module (only
 * the service client), so it can back both a server fn and the PDF route without
 * pulling client-protected imports into the client bundle.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'

export interface SettlementRow {
  id: string
  organizer_id: string
  period_month: string
  period_start: string
  period_end: string
  gross_cents: number
  fee_cents: number
  refunded_cents: number
  net_cents: number
  order_count: number
  currency: string
  status: string
  generated_at: string
}

export interface SettlementOrderLine {
  ref: string
  eventTitle: string
  paidAt: string | null
  totalCents: number
  feeCents: number
  refundedCents: number
}

export interface SettlementDetail {
  settlement: SettlementRow
  organizer: {
    name: string
    ico: string | null
    dic: string | null
    ic_dph: string | null
    iban: string | null
    email: string | null
  }
  orders: SettlementOrderLine[]
}

/** All settlements for an organizer, newest month first. */
export async function listSettlements(
  organizerId: string,
): Promise<SettlementRow[]> {
  const { data } = await serviceClient()
    .from('settlements')
    .select('*')
    .eq('organizer_id', organizerId)
    .order('period_month', { ascending: false })
    .returns<SettlementRow[]>()
  return data ?? []
}

interface RawOrder {
  id: string
  total_cents: number
  fee_cents: number
  paid_at: string | null
  events: { title: string } | null
}

/**
 * One settlement plus the orders that make it up, scoped to the organizer.
 * Returns null if the settlement does not belong to that organizer. The order
 * lines reconcile to the stored totals (same window + statuses as the SQL).
 */
export async function getSettlementForOrganizer(
  settlementId: string,
  organizerId: string,
): Promise<SettlementDetail | null> {
  const db = serviceClient()

  const { data: settlement } = await db
    .from('settlements')
    .select('*')
    .eq('id', settlementId)
    .eq('organizer_id', organizerId)
    .maybeSingle<SettlementRow>()
  if (!settlement) return null

  const { data: organizer } = await db
    .from('organizers')
    .select('name, ico, dic, ic_dph, iban, email')
    .eq('id', organizerId)
    .maybeSingle<SettlementDetail['organizer']>()

  const { data: rawOrders } = await db
    .from('orders')
    .select(
      'id, total_cents, fee_cents, paid_at, events!inner(title, organizer_id)',
    )
    .gte('paid_at', settlement.period_start)
    .lt('paid_at', settlement.period_end)
    .in('status', ['paid', 'partially_refunded', 'refunded'])
    .eq('events.organizer_id', organizerId)
    .order('paid_at', { ascending: true })
    .returns<RawOrder[]>()

  const orders = rawOrders ?? []
  const ids = orders.map((o) => o.id)

  const refundedByOrder = new Map<string, number>()
  if (ids.length > 0) {
    const { data: refunds } = await db
      .from('refunds')
      .select('order_id, amount_cents, status')
      .in('order_id', ids)
      .returns<{ order_id: string; amount_cents: number; status: string }[]>()
    for (const r of refunds ?? []) {
      if (r.status === 'failed') continue
      refundedByOrder.set(
        r.order_id,
        (refundedByOrder.get(r.order_id) ?? 0) + r.amount_cents,
      )
    }
  }

  const lines: SettlementOrderLine[] = orders.map((o) => ({
    ref: o.id.slice(0, 8).toUpperCase(),
    eventTitle: o.events?.title ?? '—',
    paidAt: o.paid_at,
    totalCents: o.total_cents,
    feeCents: o.fee_cents,
    refundedCents: refundedByOrder.get(o.id) ?? 0,
  }))

  return {
    settlement,
    organizer: organizer ?? {
      name: '—',
      ico: null,
      dic: null,
      ic_dph: null,
      iban: null,
      email: null,
    },
    orders: lines,
  }
}
