/**
 * POS overview / cash-drawer close-out for one event. Pure server logic: reads
 * the event's POS sales (paid cash/terminal orders), resolves each seller's
 * e-mail and groups totals per seller and per tender. The cash-drawer total
 * (sum of cash sales) is what staff hand over at the end.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'

export interface PosSummarySale {
  id: string
  ref: string
  created_at: string
  sellerEmail: string
  paymentMethod: 'cash' | 'terminal'
  buyerEmail: string | null
  totalCents: number
  itemsLabel: string
}

export interface PosSellerBreakdown {
  sellerEmail: string
  cashCents: number
  terminalCents: number
  cashCount: number
  terminalCount: number
  totalCents: number
}

export interface PosSummary {
  event: { id: string; title: string; timezone: string }
  sales: PosSummarySale[]
  sellers: PosSellerBreakdown[]
  totals: {
    cashCents: number
    terminalCents: number
    cashCount: number
    terminalCount: number
    totalCents: number
    /** Cash to hand over at close = sum of cash sales. */
    drawerCashCents: number
  }
}

interface RawPosOrder {
  id: string
  created_at: string
  buyer_email: string
  total_cents: number
  payment_method: 'cash' | 'terminal'
  sold_by: string | null
  order_items:
    | { quantity: number; ticket_types: { name: string } | null }[]
    | null
}

const UNKNOWN_SELLER = '—'

/**
 * Build the POS summary for one event, scoped to the caller's organizer. Returns
 * null if the event does not exist under that organizer.
 */
export async function buildPosSummary(
  eventId: string,
  organizerId: string,
): Promise<PosSummary | null> {
  const db = serviceClient()

  const { data: event } = await db
    .from('events')
    .select('id, title, timezone')
    .eq('id', eventId)
    .eq('organizer_id', organizerId)
    .maybeSingle<{ id: string; title: string; timezone: string }>()
  if (!event) return null

  const { data: rawOrders } = await db
    .from('orders')
    .select(
      'id, created_at, buyer_email, total_cents, payment_method, sold_by, order_items(quantity, ticket_types(name))',
    )
    .eq('event_id', eventId)
    .eq('status', 'paid')
    .in('payment_method', ['cash', 'terminal'])
    .order('created_at', { ascending: false })
    .returns<RawPosOrder[]>()

  // Resolve each distinct seller's e-mail once.
  const sellerEmails = new Map<string, string>()
  const sellerIds = [
    ...new Set((rawOrders ?? []).map((o) => o.sold_by).filter(Boolean)),
  ] as string[]
  for (const id of sellerIds) {
    const { data } = await db.auth.admin.getUserById(id)
    sellerEmails.set(id, data.user?.email ?? UNKNOWN_SELLER)
  }
  const emailOf = (id: string | null) =>
    (id ? sellerEmails.get(id) : null) ?? UNKNOWN_SELLER

  const sales: PosSummarySale[] = (rawOrders ?? []).map((o) => ({
    id: o.id,
    ref: o.id.slice(0, 8).toUpperCase(),
    created_at: o.created_at,
    sellerEmail: emailOf(o.sold_by),
    paymentMethod: o.payment_method,
    buyerEmail: o.buyer_email || null,
    totalCents: o.total_cents,
    itemsLabel: (o.order_items ?? [])
      .map((i) => `${i.quantity}× ${i.ticket_types?.name ?? '—'}`)
      .join(', '),
  }))

  // Group per seller + accumulate grand totals.
  const bySeller = new Map<string, PosSellerBreakdown>()
  const totals = {
    cashCents: 0,
    terminalCents: 0,
    cashCount: 0,
    terminalCount: 0,
    totalCents: 0,
    drawerCashCents: 0,
  }
  for (const s of sales) {
    const b =
      bySeller.get(s.sellerEmail) ??
      ({
        sellerEmail: s.sellerEmail,
        cashCents: 0,
        terminalCents: 0,
        cashCount: 0,
        terminalCount: 0,
        totalCents: 0,
      } satisfies PosSellerBreakdown)
    if (s.paymentMethod === 'cash') {
      b.cashCents += s.totalCents
      b.cashCount++
      totals.cashCents += s.totalCents
      totals.cashCount++
    } else {
      b.terminalCents += s.totalCents
      b.terminalCount++
      totals.terminalCents += s.totalCents
      totals.terminalCount++
    }
    b.totalCents += s.totalCents
    totals.totalCents += s.totalCents
    bySeller.set(s.sellerEmail, b)
  }
  totals.drawerCashCents = totals.cashCents

  const sellers = [...bySeller.values()].sort(
    (a, b) => b.totalCents - a.totalCents,
  )

  return { event, sales, sellers, totals }
}
