/**
 * Pure settlement arithmetic — mirrors the generate_settlements SQL so the PDF
 * and dashboard reconcile to the cent with the stored row. No DB/framework deps.
 */

export interface SettlementOrderAmounts {
  totalCents: number
  feeCents: number
  refundedCents: number
}

export interface SettlementTotals {
  grossCents: number
  feeCents: number
  refundedCents: number
  netCents: number
  orderCount: number
}

/** gross = Σtotal, fee = Σfee, refunded = Σrefunded, net = gross − fee − refunded. */
export function summarizeSettlementOrders(
  orders: SettlementOrderAmounts[],
): SettlementTotals {
  let grossCents = 0
  let feeCents = 0
  let refundedCents = 0
  for (const o of orders) {
    grossCents += o.totalCents
    feeCents += o.feeCents
    refundedCents += o.refundedCents
  }
  return {
    grossCents,
    feeCents,
    refundedCents,
    netCents: grossCents - feeCents - refundedCents,
    orderCount: orders.length,
  }
}
