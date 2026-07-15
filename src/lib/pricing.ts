/**
 * Order pricing. The single source of truth for how a cart total is computed.
 * Runs on the server with prices read from the DB — the client never sets a price.
 */

import { couponDiscountCents, type CouponType } from './coupons'

export interface PricingItem {
  quantity: number
  unitPriceCents: number
}

export interface PricingCoupon {
  type: CouponType
  value: number
}

export interface PricingInput {
  items: PricingItem[]
  coupon?: PricingCoupon | null
  /** organizers.fee_percent, e.g. 4.0 */
  feePercent: number
  /** organizers.fee_min_cents, e.g. 40 */
  feeMinCents: number
}

export interface Pricing {
  subtotalCents: number
  discountCents: number
  totalCents: number
  /** Platform commission taken from the organizer's revenue (informational). */
  feeCents: number
}

export function computeSubtotal(items: PricingItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0)
}

/** Platform commission: max(percent of amount, minimum). Zero for free orders. */
export function computeFee(
  amountCents: number,
  feePercent: number,
  feeMinCents: number,
): number {
  if (amountCents <= 0) return 0
  const pct = Math.round((amountCents * feePercent) / 100)
  return Math.max(pct, feeMinCents)
}

export function computePricing(input: PricingInput): Pricing {
  const subtotalCents = computeSubtotal(input.items)
  const discountCents = input.coupon
    ? couponDiscountCents(input.coupon, subtotalCents)
    : 0
  const totalCents = subtotalCents - discountCents
  const feeCents = computeFee(totalCents, input.feePercent, input.feeMinCents)
  return { subtotalCents, discountCents, totalCents, feeCents }
}
