/**
 * Realized revenue with refunds netted out — the single definition shared by the
 * live dashboard snapshot, the sales-page loader and (by matching its formula)
 * the settlement view.
 *
 * The model mirrors settlements exactly: `net = gross − fee − refunded`, where
 *   gross    = Σ total_cents over orders that were actually paid
 *              (status paid / partially_refunded / refunded),
 *   fee      = Σ fee_cents over those same orders — the platform KEEPS its fee
 *              even on a refund, so it is a separate, always-visible line and net
 *              is never a mysterious negative,
 *   refunded = Σ amount_cents over refund-ledger rows that did not fail.
 *
 * Pure — no DB or client imports — so it is trivially unit-testable and safe on
 * both sides.
 */

import type { OrderStatus } from '../lib/db-types'

/** Orders whose money was collected and therefore counts toward gross. */
export const REALIZED_ORDER_STATUSES: OrderStatus[] = [
  'paid',
  'partially_refunded',
  'refunded',
]

export interface RevenueOrder {
  status: OrderStatus
  total_cents: number
  fee_cents: number
}

export interface RevenueRefund {
  amount_cents: number
  /** 'requested' | 'done' | 'failed' — a failed refund never left the gateway. */
  status: string
}

export interface RealizedRevenue {
  /** Money collected (paid + partially/fully refunded orders' original totals). */
  grossCents: number
  /** Platform fee on that gross — kept on refund, shown as its own line. */
  feeCents: number
  /** Money returned to buyers (non-failed refunds). */
  refundedCents: number
  /** Organizer's realized net: gross − fee − refunded. */
  netCents: number
  /** Number of orders that contributed to gross. */
  orderCount: number
}

export function isRealizedOrder(status: OrderStatus): boolean {
  return REALIZED_ORDER_STATUSES.includes(status)
}

/** A refund actually moved money unless the gateway call failed. */
export function refundCounts(status: string): boolean {
  return status !== 'failed'
}

export function computeRealizedRevenue(
  orders: RevenueOrder[],
  refunds: RevenueRefund[],
): RealizedRevenue {
  let grossCents = 0
  let feeCents = 0
  let orderCount = 0
  for (const o of orders) {
    if (!isRealizedOrder(o.status)) continue
    grossCents += o.total_cents
    feeCents += o.fee_cents
    orderCount += 1
  }

  let refundedCents = 0
  for (const r of refunds) {
    if (refundCounts(r.status)) refundedCents += r.amount_cents
  }

  return {
    grossCents,
    feeCents,
    refundedCents,
    netCents: grossCents - feeCents - refundedCents,
    orderCount,
  }
}
