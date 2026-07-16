/**
 * Maps a GoPay payment state to the order action our reconcile step should take.
 * Pure — no imports — so the full state diagram is unit-testable.
 *
 * GoPay states (doc.gopay.com): CREATED, PAYMENT_METHOD_CHOSEN, PAID, AUTHORIZED,
 * CANCELED, TIMEOUTED, REFUNDED, PARTIALLY_REFUNDED. A payment can transition
 * more than once (e.g. PAID → PARTIALLY_REFUNDED → REFUNDED), so reconcile must be
 * idempotent for every action.
 */

export type GoPayOrderAction =
  | 'fulfill' // PAID → mark paid + issue tickets
  | 'refund_full' // REFUNDED → sync order to refunded
  | 'refund_partial' // PARTIALLY_REFUNDED → sync order to partially_refunded
  | 'cancel' // CANCELED / TIMEOUTED → drop an unpaid reservation
  | 'none' // CREATED / PAYMENT_METHOD_CHOSEN / AUTHORIZED / unknown → wait

export function gopayStateToAction(state: string): GoPayOrderAction {
  switch (state) {
    case 'PAID':
      return 'fulfill'
    case 'REFUNDED':
      return 'refund_full'
    case 'PARTIALLY_REFUNDED':
      return 'refund_partial'
    case 'CANCELED':
    case 'TIMEOUTED':
      return 'cancel'
    // CREATED, PAYMENT_METHOD_CHOSEN, AUTHORIZED and anything unknown: no order
    // change yet — a later notification / reconcile will move it forward.
    default:
      return 'none'
  }
}
