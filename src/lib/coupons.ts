/**
 * Coupon validation and discount math. Pure functions — the authoritative
 * apply happens server-side (see server/order-service). The client never
 * decides a discount.
 */

export type CouponType = 'percent' | 'fixed'

export interface CouponLike {
  code: string
  type: CouponType
  value: number // percent: whole-percent points (0-100); fixed: cents
  max_uses: number | null
  used_count: number
  valid_from: string | null // ISO timestamptz
  valid_until: string | null
}

export type CouponRejectReason =
  | 'not_found'
  | 'not_yet_valid'
  | 'expired'
  | 'exhausted'

export interface CouponValidation {
  ok: boolean
  reason?: CouponRejectReason
}

/** Validate a coupon's usability at a point in time (ignores the cart amount). */
export function validateCoupon(
  coupon: CouponLike,
  now: Date = new Date(),
): CouponValidation {
  if (coupon.valid_from && now < new Date(coupon.valid_from)) {
    return { ok: false, reason: 'not_yet_valid' }
  }
  if (coupon.valid_until && now > new Date(coupon.valid_until)) {
    return { ok: false, reason: 'expired' }
  }
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
    return { ok: false, reason: 'exhausted' }
  }
  return { ok: true }
}

/**
 * Discount in cents for a given subtotal. Always clamped to [0, subtotal] so a
 * coupon can never make an order negative.
 */
export function couponDiscountCents(
  coupon: Pick<CouponLike, 'type' | 'value'>,
  subtotalCents: number,
): number {
  if (subtotalCents <= 0) return 0
  const raw =
    coupon.type === 'percent'
      ? Math.floor((subtotalCents * coupon.value) / 100)
      : coupon.value
  return Math.max(0, Math.min(raw, subtotalCents))
}

const REASON_MESSAGES_SK: Record<CouponRejectReason, string> = {
  not_found: 'Kupón neexistuje.',
  not_yet_valid: 'Kupón ešte nie je platný.',
  expired: 'Platnosť kupónu vypršala.',
  exhausted: 'Kupón už bol vyčerpaný.',
}

export function couponRejectMessage(reason: CouponRejectReason): string {
  return REASON_MESSAGES_SK[reason]
}
