/**
 * Settlement net formula, shared so the payout "available" figure matches the
 * settlement net exactly (incl. partial refunds).
 *
 *   net = Σ(order total) − Σ(order fee) − Σ(non-failed refunds)
 *
 * Same definition as the SQL `generate_settlements` / `recompute_settlement`.
 */

export interface NetOrder {
  total_cents: number
  fee_cents: number
}

export interface RefundLike {
  amount_cents: number
  status: string
}

/** Sum of refunds that actually happened (anything except 'failed'). */
export function sumRefunds(refunds: RefundLike[]): number {
  return refunds
    .filter((r) => r.status !== 'failed')
    .reduce((s, r) => s + r.amount_cents, 0)
}

/** net = gross − fee − refunded, over the given orders + their refunds. */
export function settlementNet(
  orders: NetOrder[],
  refunds: RefundLike[],
): number {
  const gross = orders.reduce((s, o) => s + o.total_cents, 0)
  const fee = orders.reduce((s, o) => s + o.fee_cents, 0)
  return gross - fee - sumRefunds(refunds)
}
