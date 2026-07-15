/**
 * Hand-written row shapes for the tables the public flow touches. Kept minimal on
 * purpose; can be replaced by `supabase gen types` output later.
 */

export type EventStatus = 'draft' | 'published' | 'ended' | 'cancelled'
export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'expired'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded'
export type TicketStatus = 'valid' | 'used' | 'cancelled'

export type OrganizerStatus = 'active' | 'suspended'

/** JSON-compatible value (matches a jsonb column, and stays serializable across
 *  the server-fn boundary — `unknown` would not). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface OrganizerRow {
  id: string
  name: string
  slug: string
  fee_percent: number
  fee_min_cents: number
  gopay_goid: string | null
  status: OrganizerStatus
  admin_notes: string | null
}

export interface AuditLogRow {
  id: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  old_value: JsonValue
  new_value: JsonValue
  created_at: string
}

export interface EventRow {
  id: string
  organizer_id: string
  title: string
  slug: string
  description: string | null
  venue_name: string | null
  venue_address: string | null
  starts_at: string
  ends_at: string | null
  timezone: string
  cover_url: string | null
  status: EventStatus
  qr_secret: string
}

export interface TicketTypeRow {
  id: string
  event_id: string
  name: string
  description: string | null
  price_cents: number
  currency: string
  capacity: number
  sold_count: number
  sale_starts_at: string | null
  sale_ends_at: string | null
  max_per_order: number
  sort_order: number
  hidden: boolean
}

export interface OrderRow {
  id: string
  event_id: string
  buyer_email: string
  buyer_name: string | null
  buyer_phone: string | null
  status: OrderStatus
  subtotal_cents: number
  discount_cents: number
  total_cents: number
  fee_cents: number
  coupon_id: string | null
  gopay_payment_id: string | null
  expires_at: string | null
  created_at: string
  paid_at: string | null
}

export interface OrderItemRow {
  id: string
  order_id: string
  ticket_type_id: string
  quantity: number
  unit_price_cents: number
}

export interface TicketRow {
  id: string
  order_id: string
  ticket_type_id: string
  event_id: string
  holder_name: string | null
  status: TicketStatus
  used_at: string | null
}

export interface CouponRow {
  id: string
  event_id: string
  code: string
  type: 'percent' | 'fixed'
  value: number
  max_uses: number | null
  used_count: number
  valid_from: string | null
  valid_until: string | null
}
