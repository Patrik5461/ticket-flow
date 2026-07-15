/**
 * Pure refund arithmetic. No DB / gateway — safe to unit-test in isolation.
 *
 * Money is integer cents. The buyer paid `totalCents` (subtotal minus discount);
 * a single-ticket refund returns that ticket's share of what was actually paid,
 * never more than what remains refundable.
 */

export interface TicketRefundInput {
  /** List price of the ticket's type, as snapshotted on the order. */
  unitPriceCents: number
  /** Order subtotal (sum of list prices before discount). */
  subtotalCents: number
  /** What the buyer actually paid (subtotal − discount). */
  totalCents: number
  /** Amount still refundable on the order (total − already refunded). */
  remainingCents: number
}

/**
 * The refund due for one ticket: its proportional share of the paid total,
 * capped at the amount still refundable. Zero when the order was free or nothing
 * remains. Proportion is by list price, so a discount is shared fairly.
 */
export function ticketRefundCents(input: TicketRefundInput): number {
  const { unitPriceCents, subtotalCents, totalCents, remainingCents } = input
  if (remainingCents <= 0 || totalCents <= 0 || subtotalCents <= 0) return 0
  const share = Math.round((unitPriceCents * totalCents) / subtotalCents)
  return Math.max(0, Math.min(share, remainingCents))
}

/**
 * Order status after a refund, from how many of its tickets remain active
 * (i.e. not cancelled). None left → fully 'refunded'; some left → 'partially_refunded'.
 */
export function orderStatusAfterRefund(
  activeTicketsRemaining: number,
): 'refunded' | 'partially_refunded' {
  return activeTicketsRemaining <= 0 ? 'refunded' : 'partially_refunded'
}
