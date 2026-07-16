/**
 * Public order flow — the server-authoritative core. Prices, discounts, capacity
 * reservation, payment and fulfilment all live here. Callers (server functions,
 * server routes) pass validated input; this module never trusts a client price.
 *
 * Server-only.
 */

import { serviceClient, anonClient } from '../lib/supabase/server'
import { getEnv, isGoPayConfigured } from '../lib/env'
import { computePricing } from '../lib/pricing'
import {
  validateCoupon,
  couponRejectMessage,
  couponDiscountCents,
} from '../lib/coupons'
import { signOrderToken, verifyOrderToken } from '../lib/order-token'
import { signTicket } from '../lib/qr'
import { qrDataUrl } from '../lib/tickets/qr-image'
import { renderTicketPdf } from '../lib/tickets/pdf'
import { getEmailProvider } from '../lib/email'
import {
  ticketsEmail,
  ticketBlockHtml,
  orderPendingEmail,
} from '../lib/email/templates'
import { formatEur } from '../lib/money'
import { createPayment, getPaymentStatus } from '../lib/gopay'
import { gopayStateToAction } from '../lib/gopay-state'
import {
  googleWalletSaveUrl,
  appleWalletConfigured,
  generateApplePkpass,
} from '../lib/wallet'
import {
  parseCustomFields,
  validateAnswers
  
} from '../lib/custom-fields'
import type {CustomField} from '../lib/custom-fields';
import type {
  EventRow,
  OrganizerRow,
  TicketTypeRow,
  OrderRow,
  OrderItemRow,
  TicketRow,
  CouponRow,
} from '../lib/db-types'

const RESERVATION_MINUTES = 15

// Columns safe to expose publicly (qr_secret intentionally excluded).
const PUBLIC_EVENT_COLS =
  'id, organizer_id, title, slug, description, venue_name, venue_address, starts_at, ends_at, timezone, cover_url, status, ga4_measurement_id, meta_pixel_id'

// Same as PUBLIC_EVENT_COLS but without the tracking columns — a fallback for
// databases where the event-tracking migration hasn't been applied yet, so the
// public pages keep working (tracking just inactive until the migration lands).
const PUBLIC_EVENT_COLS_LEGACY =
  'id, organizer_id, title, slug, description, venue_name, venue_address, starts_at, ends_at, timezone, cover_url, status'

export type PublicEvent = Omit<EventRow, 'qr_secret'>

export interface PublicTicketType {
  id: string
  name: string
  description: string | null
  price_cents: number
  currency: string
  max_per_order: number
  sort_order: number
  sold_out: boolean
  customFields: CustomField[]
}

export class OrderError extends Error {}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getPublicEvent(
  slug: string,
): Promise<{ event: PublicEvent; ticketTypes: PublicTicketType[] } | null> {
  // Public read: anon client (RLS allows published events + non-hidden types),
  // so the landing/event pages render without a service role key.
  const db = anonClient()
  const primary = await db
    .from('events')
    .select(PUBLIC_EVENT_COLS)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle<PublicEvent>()
  const event = primary.error
    ? (
        await db
          .from('events')
          .select(PUBLIC_EVENT_COLS_LEGACY)
          .eq('slug', slug)
          .eq('status', 'published')
          .maybeSingle<PublicEvent>()
      ).data
    : primary.data

  if (!event) return null

  const { data: types } = await db
    .from('ticket_types')
    .select('*')
    .eq('event_id', event.id)
    .eq('hidden', false)
    .order('sort_order', { ascending: true })
    .returns<TicketTypeRow[]>()

  const ticketTypes = (types ?? []).map(toPublicTicketType)
  return { event, ticketTypes }
}

function toPublicTicketType(t: TicketTypeRow): PublicTicketType {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    price_cents: t.price_cents,
    currency: t.currency,
    max_per_order: t.max_per_order,
    sort_order: t.sort_order,
    sold_out: t.sold_count >= t.capacity,
    customFields: parseCustomFields(t.custom_fields),
  }
}

export async function listPublishedEvents(): Promise<PublicEvent[]> {
  const db = anonClient()
  const primary = await db
    .from('events')
    .select(PUBLIC_EVENT_COLS)
    .eq('status', 'published')
    .order('starts_at', { ascending: true })
    .returns<PublicEvent[]>()
  if (!primary.error) return primary.data

  const { data: legacy } = await db
    .from('events')
    .select(PUBLIC_EVENT_COLS_LEGACY)
    .eq('status', 'published')
    .order('starts_at', { ascending: true })
    .returns<PublicEvent[]>()
  return legacy ?? []
}

// ---------------------------------------------------------------------------
// Pricing preview (+ coupon)
// ---------------------------------------------------------------------------

export interface CartItemInput {
  ticketTypeId: string
  quantity: number
}

export interface PricingPreview {
  subtotalCents: number
  discountCents: number
  totalCents: number
  currency: string
  lines: { name: string; quantity: number; unitPriceCents: number }[]
  coupon:
    | { ok: true; code: string; discountCents: number }
    | { ok: false; message: string }
    | null
}

async function loadPurchasableTypes(
  eventId: string,
  items: CartItemInput[],
): Promise<Map<string, TicketTypeRow>> {
  const ids = items.map((i) => i.ticketTypeId)
  const db = serviceClient()
  const { data } = await db
    .from('ticket_types')
    .select('*')
    .eq('event_id', eventId)
    .in('id', ids)
    .returns<TicketTypeRow[]>()

  const now = Date.now()
  const map = new Map<string, TicketTypeRow>()
  for (const t of data ?? []) {
    if (t.hidden) continue
    if (t.sale_starts_at && now < new Date(t.sale_starts_at).getTime()) continue
    if (t.sale_ends_at && now > new Date(t.sale_ends_at).getTime()) continue
    map.set(t.id, t)
  }
  return map
}

export async function previewPricing(
  slug: string,
  items: CartItemInput[],
  couponCode?: string | null,
): Promise<PricingPreview> {
  const db = serviceClient()
  const { data: event } = await db
    .from('events')
    .select('id')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle<{ id: string }>()
  if (!event) throw new OrderError('Podujatie sa nenašlo.')

  const { data: organizer } = await db
    .from('events')
    .select('organizers(fee_percent, fee_min_cents)')
    .eq('id', event.id)
    .single<{
      organizers: Pick<OrganizerRow, 'fee_percent' | 'fee_min_cents'>
    }>()

  const types = await loadPurchasableTypes(event.id, items)

  const lines: PricingPreview['lines'] = []
  const pricingItems = []
  for (const item of items) {
    const t = types.get(item.ticketTypeId)
    if (!t || item.quantity <= 0) continue
    lines.push({
      name: t.name,
      quantity: item.quantity,
      unitPriceCents: t.price_cents,
    })
    pricingItems.push({
      quantity: item.quantity,
      unitPriceCents: t.price_cents,
    })
  }

  const subtotalCents = pricingItems.reduce(
    (s, i) => s + i.quantity * i.unitPriceCents,
    0,
  )

  let couponResult: PricingPreview['coupon'] = null
  let pricingCoupon: { type: 'percent' | 'fixed'; value: number } | null = null
  if (couponCode) {
    const { data: coupon } = await db
      .from('coupons')
      .select('*')
      .eq('event_id', event.id)
      .eq('code', couponCode)
      .maybeSingle<CouponRow>()
    if (!coupon) {
      couponResult = { ok: false, message: couponRejectMessage('not_found') }
    } else {
      const v = validateCoupon(coupon)
      if (!v.ok) {
        couponResult = { ok: false, message: couponRejectMessage(v.reason!) }
      } else {
        pricingCoupon = { type: coupon.type, value: coupon.value }
        couponResult = {
          ok: true,
          code: coupon.code,
          discountCents: couponDiscountCents(pricingCoupon, subtotalCents),
        }
      }
    }
  }

  const pricing = computePricing({
    items: pricingItems,
    coupon: pricingCoupon,
    feePercent: organizer?.organizers.fee_percent ?? 4.0,
    feeMinCents: organizer?.organizers.fee_min_cents ?? 40,
  })

  return {
    subtotalCents: pricing.subtotalCents,
    discountCents: pricing.discountCents,
    totalCents: pricing.totalCents,
    currency: 'EUR',
    lines,
    coupon: couponResult,
  }
}

// ---------------------------------------------------------------------------
// Create order
// ---------------------------------------------------------------------------

export interface CreateOrderBilling {
  ico?: string | null
  dic?: string | null
  icDph?: string | null
  name?: string | null
  address?: string | null
}

export interface CreateOrderInput {
  slug: string
  items: CartItemInput[]
  buyer: { email: string; name?: string; phone?: string }
  couponCode?: string | null
  billing?: CreateOrderBilling | null
  /** Attendee answers keyed by ticket_type_id, one entry per quantity unit. */
  answers?: Record<string, Array<Record<string, string>>> | null
}

export interface CreateOrderResult {
  orderId: string
  token: string
  /** Where to send the buyer next: GoPay gateway, or the order page for free orders. */
  redirectUrl: string
}

export async function createOrder(
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const db = serviceClient()

  // 1. Event (need qr_secret to sign the access token).
  const { data: event } = await db
    .from('events')
    .select('*')
    .eq('slug', input.slug)
    .eq('status', 'published')
    .maybeSingle<EventRow>()
  if (!event)
    throw new OrderError('Podujatie sa nenašlo alebo nie je zverejnené.')

  // 2. Organizer fee + status. A suspended organizer may not sell.
  const { data: organizer } = await db
    .from('organizers')
    .select('fee_percent, fee_min_cents, status')
    .eq('id', event.organizer_id)
    .single<Pick<OrganizerRow, 'fee_percent' | 'fee_min_cents' | 'status'>>()
  if (organizer?.status === 'suspended') {
    throw new OrderError(
      'Predaj vstupeniek je pre tohto organizátora pozastavený.',
    )
  }

  // 3. Ticket types on sale.
  const types = await loadPurchasableTypes(event.id, input.items)
  const cleanItems = input.items.filter(
    (i) => i.quantity > 0 && types.has(i.ticketTypeId),
  )
  if (cleanItems.length === 0) {
    throw new OrderError(
      'Košík je prázdny alebo vybrané vstupenky nie sú v predaji.',
    )
  }
  for (const item of cleanItems) {
    const t = types.get(item.ticketTypeId)!
    if (item.quantity > t.max_per_order) {
      throw new OrderError(
        `Pre "${t.name}" je maximum ${t.max_per_order} ks na objednávku.`,
      )
    }
    // Custom-field validation: one answer set per quantity unit.
    const fields = parseCustomFields(t.custom_fields)
    if (fields.length > 0) {
      const sets = input.answers?.[item.ticketTypeId] ?? []
      for (let n = 0; n < item.quantity; n++) {
        const err = validateAnswers(fields, sets[n] ?? {})
        if (err) {
          throw new OrderError(`${t.name}: ${err.message}`)
        }
      }
    }
  }

  // 4. Coupon.
  let coupon: CouponRow | null = null
  if (input.couponCode) {
    const { data } = await db
      .from('coupons')
      .select('*')
      .eq('event_id', event.id)
      .eq('code', input.couponCode)
      .maybeSingle<CouponRow>()
    if (!data) throw new OrderError(couponRejectMessage('not_found'))
    const v = validateCoupon(data)
    if (!v.ok) throw new OrderError(couponRejectMessage(v.reason!))
    coupon = data
  }

  // 5. Server-side pricing.
  const pricing = computePricing({
    items: cleanItems.map((i) => ({
      quantity: i.quantity,
      unitPriceCents: types.get(i.ticketTypeId)!.price_cents,
    })),
    coupon: coupon ? { type: coupon.type, value: coupon.value } : null,
    feePercent: organizer?.fee_percent ?? 4.0,
    feeMinCents: organizer?.fee_min_cents ?? 40,
  })

  // 6. Reserve capacity atomically, compensating on the first failure.
  const reserved: CartItemInput[] = []
  for (const item of cleanItems) {
    const { data: ok, error } = await db.rpc('reserve_ticket_capacity', {
      p_ticket_type_id: item.ticketTypeId,
      p_qty: item.quantity,
    })
    if (error) {
      await releaseAll(reserved)
      throw new OrderError('Nepodarilo sa rezervovať vstupenky, skúste znova.')
    }
    if (!ok) {
      await releaseAll(reserved)
      const name = types.get(item.ticketTypeId)!.name
      throw new OrderError(
        `"${name}" je vypredaná alebo nie je dostatok kusov.`,
      )
    }
    reserved.push(item)
  }

  // 7. Persist the order + items. Compensate capacity if this fails.
  const expiresAt = new Date(
    Date.now() + RESERVATION_MINUTES * 60_000,
  ).toISOString()
  const { data: order, error: orderErr } = await db
    .from('orders')
    .insert({
      event_id: event.id,
      buyer_email: input.buyer.email,
      buyer_name: input.buyer.name ?? null,
      buyer_phone: input.buyer.phone ?? null,
      status: 'pending',
      subtotal_cents: pricing.subtotalCents,
      discount_cents: pricing.discountCents,
      total_cents: pricing.totalCents,
      fee_cents: pricing.feeCents,
      coupon_id: coupon?.id ?? null,
      expires_at: expiresAt,
      billing_ico: input.billing?.ico ?? null,
      billing_dic: input.billing?.dic ?? null,
      billing_ic_dph: input.billing?.icDph ?? null,
      billing_name: input.billing?.name ?? null,
      billing_address: input.billing?.address ?? null,
    })
    .select('*')
    .single<OrderRow>()
  if (orderErr || !order) {
    await releaseAll(reserved)
    throw new OrderError('Objednávku sa nepodarilo vytvoriť.')
  }

  const { error: itemsErr } = await db.from('order_items').insert(
    cleanItems.map((i) => ({
      order_id: order.id,
      ticket_type_id: i.ticketTypeId,
      quantity: i.quantity,
      unit_price_cents: types.get(i.ticketTypeId)!.price_cents,
    })),
  )
  if (itemsErr) {
    await releaseAll(reserved)
    await db.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
    throw new OrderError('Objednávku sa nepodarilo vytvoriť.')
  }

  // Stage attendee answers (best-effort: tolerate a pre-migration DB).
  if (input.answers) {
    await db
      .from('orders')
      .update({ custom_answers: input.answers })
      .eq('id', order.id)
      .then(
        () => undefined,
        () => undefined,
      )
  }

  const token = signOrderToken(order.id, event.qr_secret)
  const orderPageUrl = buildOrderUrl(order.id, token)

  // 8. Free order → fulfil immediately, no gateway.
  if (pricing.totalCents === 0) {
    await markPaidAndFulfill(order, event)
    return { orderId: order.id, token, redirectUrl: orderPageUrl }
  }

  // 9. Paid order → create the GoPay payment.
  if (!isGoPayConfigured()) {
    await releaseAll(reserved)
    await db.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
    throw new OrderError(
      'Platobná brána GoPay zatiaľ nie je nakonfigurovaná (doplňte GOPAY_* do .env).',
    )
  }

  try {
    const payment = await createPayment({
      amountCents: pricing.totalCents,
      orderNumber: order.id,
      description: event.title,
      buyer: { email: input.buyer.email, name: input.buyer.name },
      items: cleanItems.map((i) => {
        const t = types.get(i.ticketTypeId)!
        return { name: t.name, amountCents: t.price_cents, count: i.quantity }
      }),
      returnUrl: orderPageUrl,
      notificationUrl: `${getEnv().APP_URL}/api/gopay/notify`,
    })

    await db
      .from('orders')
      .update({ gopay_payment_id: String(payment.id) })
      .eq('id', order.id)

    // Best-effort "awaiting payment" email — must not block the redirect.
    await sendPendingEmail(order, event, pricing.totalCents, token).catch(
      () => undefined,
    )

    return {
      orderId: order.id,
      token,
      redirectUrl: payment.gw_url ?? orderPageUrl,
    }
  } catch (e) {
    await releaseAll(reserved)
    await db.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
    throw new OrderError(
      e instanceof Error ? e.message : 'Platbu sa nepodarilo vytvoriť.',
    )
  }
}

export interface ManualOrderInput {
  eventId: string
  items: CartItemInput[]
  buyer: { email: string; name?: string; phone?: string }
}

/**
 * Organizer-recorded sale (on-site / bank transfer). Creates an already-paid
 * order (payment_method 'manual', no GoPay), reserves capacity, issues tickets
 * and emails them. Pricing (incl. the platform fee) is computed server-side from
 * the organizer's config, so the order shows up in sales + settlements like any
 * paid order. The caller must already have authorized the organizer for the event.
 */
export async function createManualOrder(
  input: ManualOrderInput,
): Promise<{ orderId: string }> {
  const db = serviceClient()

  const { data: event } = await db
    .from('events')
    .select('*')
    .eq('id', input.eventId)
    .maybeSingle<EventRow>()
  if (!event) throw new OrderError('Podujatie sa nenašlo.')

  const { data: organizer } = await db
    .from('organizers')
    .select('fee_percent, fee_min_cents')
    .eq('id', event.organizer_id)
    .single<Pick<OrganizerRow, 'fee_percent' | 'fee_min_cents'>>()

  // Load the requested types for this event (organizer may sell hidden types or
  // outside the public sale window — this is a manual, staff-side sale).
  const ids = input.items.map((i) => i.ticketTypeId)
  const { data: typeRows } = await db
    .from('ticket_types')
    .select('*')
    .eq('event_id', event.id)
    .in('id', ids)
    .returns<TicketTypeRow[]>()
  const types = new Map((typeRows ?? []).map((t) => [t.id, t]))

  const cleanItems = input.items.filter(
    (i) => i.quantity > 0 && types.has(i.ticketTypeId),
  )
  if (cleanItems.length === 0) {
    throw new OrderError('Vyberte aspoň jednu vstupenku.')
  }

  const pricing = computePricing({
    items: cleanItems.map((i) => ({
      quantity: i.quantity,
      unitPriceCents: types.get(i.ticketTypeId)!.price_cents,
    })),
    coupon: null,
    feePercent: organizer?.fee_percent ?? 4.0,
    feeMinCents: organizer?.fee_min_cents ?? 40,
  })

  const reserved: CartItemInput[] = []
  for (const item of cleanItems) {
    const { data: ok, error } = await db.rpc('reserve_ticket_capacity', {
      p_ticket_type_id: item.ticketTypeId,
      p_qty: item.quantity,
    })
    if (error || !ok) {
      await releaseAll(reserved)
      const name = types.get(item.ticketTypeId)!.name
      throw new OrderError(`"${name}" nemá dostatok voľných miest.`)
    }
    reserved.push(item)
  }

  const { data: order, error: orderErr } = await db
    .from('orders')
    .insert({
      event_id: event.id,
      buyer_email: input.buyer.email,
      buyer_name: input.buyer.name ?? null,
      buyer_phone: input.buyer.phone ?? null,
      status: 'paid',
      payment_method: 'manual',
      subtotal_cents: pricing.subtotalCents,
      discount_cents: pricing.discountCents,
      total_cents: pricing.totalCents,
      fee_cents: pricing.feeCents,
      paid_at: new Date().toISOString(),
    })
    .select('*')
    .maybeSingle<OrderRow>()
  if (orderErr || !order) {
    await releaseAll(reserved)
    throw new OrderError('Objednávku sa nepodarilo vytvoriť.')
  }

  const { error: itemsErr } = await db.from('order_items').insert(
    cleanItems.map((i) => ({
      order_id: order.id,
      ticket_type_id: i.ticketTypeId,
      quantity: i.quantity,
      unit_price_cents: types.get(i.ticketTypeId)!.price_cents,
    })),
  )
  if (itemsErr) {
    await releaseAll(reserved)
    await db.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
    throw new OrderError('Objednávku sa nepodarilo vytvoriť.')
  }

  const tickets = await ensureTickets(order)
  await sendTicketEmail(order, event, tickets).catch(() => undefined)

  return { orderId: order.id }
}

async function releaseAll(items: CartItemInput[]): Promise<void> {
  const db = serviceClient()
  for (const i of items) {
    await db.rpc('release_ticket_capacity', {
      p_ticket_type_id: i.ticketTypeId,
      p_qty: i.quantity,
    })
  }
}

// ---------------------------------------------------------------------------
// Fulfilment
// ---------------------------------------------------------------------------

async function markPaidAndFulfill(
  order: OrderRow,
  event: EventRow,
): Promise<void> {
  const db = serviceClient()

  // Guard the paid transition: only the first caller flips pending -> paid.
  const { data: updated } = await db
    .from('orders')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', order.id)
    .in('status', ['pending'])
    .select('id')
    .maybeSingle()

  if (!updated) {
    // Already paid/fulfilled by a concurrent caller (webhook vs return page).
    return
  }

  if (order.coupon_id) {
    await db.rpc('increment_coupon_use', { p_coupon_id: order.coupon_id }).then(
      () => undefined,
      () => undefined, // best-effort; coupon accounting must not block fulfilment
    )
  }

  const tickets = await ensureTickets(order)
  await sendTicketEmail(order, event, tickets)
}

async function ensureTickets(order: OrderRow): Promise<TicketRow[]> {
  const db = serviceClient()
  const { data: existing } = await db
    .from('tickets')
    .select('*')
    .eq('order_id', order.id)
    .returns<TicketRow[]>()
  if (existing && existing.length > 0) return existing

  const { data: items } = await db
    .from('order_items')
    .select('*')
    .eq('order_id', order.id)
    .returns<OrderItemRow[]>()

  // Answers staged at checkout + the field schema per type (both tolerant to a
  // pre-migration DB, where they're simply absent).
  const answers = await loadOrderAnswers(order.id)
  const fieldsByType = await loadFieldsByType(
    (items ?? []).map((i) => i.ticket_type_id),
  )

  const created: TicketRow[] = []
  for (const item of items ?? []) {
    const fields = fieldsByType.get(item.ticket_type_id) ?? []
    const sets = answers[item.ticket_type_id] ?? []
    for (let n = 0; n < item.quantity; n++) {
      const { data: ticket } = await db
        .from('tickets')
        .insert({
          order_id: order.id,
          ticket_type_id: item.ticket_type_id,
          event_id: order.event_id,
          status: 'valid',
        })
        .select('*')
        .maybeSingle<TicketRow>()
      if (!ticket) continue
      created.push(ticket)

      const ans = sets[n] ?? {}
      if (fields.length > 0) {
        await db
          .from('ticket_answers')
          .insert(
            fields.map((f) => ({
              ticket_id: ticket.id,
              order_id: order.id,
              event_id: order.event_id,
              field_key: f.key,
              field_label: f.label,
              value: ans[f.key] ?? null,
            })),
          )
          .then(
            () => undefined,
            () => undefined,
          )
      }
    }
  }
  return created
}

/** Read staged attendee answers off the order (tolerant of a pre-migration DB). */
async function loadOrderAnswers(
  orderId: string,
): Promise<Record<string, Array<Record<string, string>>>> {
  const { data } = await serviceClient()
    .from('orders')
    .select('custom_answers')
    .eq('id', orderId)
    .maybeSingle<{
      custom_answers: Record<string, Array<Record<string, string>>> | null
    }>()
  return data?.custom_answers ?? {}
}

/** The custom-field schema per ticket type (tolerant of a pre-migration DB). */
async function loadFieldsByType(
  typeIds: string[],
): Promise<Map<string, CustomField[]>> {
  const map = new Map<string, CustomField[]>()
  if (typeIds.length === 0) return map
  const { data } = await serviceClient()
    .from('ticket_types')
    .select('id, custom_fields')
    .in('id', typeIds)
    .returns<{ id: string; custom_fields: unknown }[]>()
  for (const t of data ?? []) {
    map.set(t.id, parseCustomFields(t.custom_fields))
  }
  return map
}

async function sendPendingEmail(
  order: OrderRow,
  event: EventRow,
  totalCents: number,
  token: string,
): Promise<void> {
  const { subject, html } = orderPendingEmail({
    eventTitle: event.title,
    whenLabel: formatEventDate(event.starts_at, event.timezone),
    orderRef: order.id.slice(0, 8).toUpperCase(),
    totalLabel: formatEur(totalCents),
    orderUrl: buildOrderUrl(order.id, token),
  })
  await getEmailProvider().send({ to: order.buyer_email, subject, html })
}

async function sendTicketEmail(
  order: OrderRow,
  event: EventRow,
  tickets: TicketRow[],
): Promise<void> {
  const typeNames = await ticketTypeNames(tickets.map((t) => t.ticket_type_id))
  const startsLabel = formatEventDate(event.starts_at, event.timezone)
  const orderToken = signOrderToken(order.id, event.qr_secret)
  const appleAvailable = appleWalletConfigured()
  const appUrl = getEnv().APP_URL

  const attachments = []
  const qrBlocks: string[] = []
  for (const t of tickets) {
    const qrToken = signTicket(t.id, event.qr_secret)
    const typeName = typeNames.get(t.ticket_type_id) ?? 'Vstupenka'
    const pdf = await renderTicketPdf({
      eventTitle: event.title,
      venue: event.venue_name,
      startsAtLabel: startsLabel,
      ticketTypeName: typeName,
      holderName: t.holder_name,
      ticketRef: t.id.slice(0, 8).toUpperCase(),
      qrToken,
    })
    attachments.push({
      filename: `vstupenka-${t.id.slice(0, 8)}.pdf`,
      content: pdf,
      contentType: 'application/pdf',
    })
    qrBlocks.push(
      ticketBlockHtml(typeName, await qrDataUrl(qrToken), {
        appleUrl: appleAvailable
          ? `${appUrl}/api/orders/${order.id}/tickets/${t.id}/pass?t=${encodeURIComponent(orderToken)}`
          : null,
        googleUrl: googleWalletSaveUrl({
          ticketId: t.id,
          eventId: event.id,
          ref: t.id.slice(0, 8).toUpperCase(),
          eventTitle: event.title,
          whenLabel: startsLabel,
          startsAtIso: event.starts_at,
          venue: event.venue_name,
          ticketTypeName: typeName,
          holderName: t.holder_name,
          qrToken,
        }),
      }),
    )
  }

  const { subject, html } = ticketsEmail({
    eventTitle: event.title,
    whenLabel: startsLabel,
    venue: event.venue_name,
    orderRef: order.id.slice(0, 8).toUpperCase(),
    ticketsHtml: qrBlocks.join(''),
  })

  await getEmailProvider().send({
    to: order.buyer_email,
    subject,
    html,
    attachments,
  })
}

async function ticketTypeNames(ids: string[]): Promise<Map<string, string>> {
  const db = serviceClient()
  const unique = [...new Set(ids)]
  const { data } = await db
    .from('ticket_types')
    .select('id, name')
    .in('id', unique)
    .returns<{ id: string; name: string }[]>()
  return new Map((data ?? []).map((t) => [t.id, t.name]))
}

// ---------------------------------------------------------------------------
// Order page + reconciliation
// ---------------------------------------------------------------------------

export interface OrderView {
  order: Pick<
    OrderRow,
    | 'id'
    | 'status'
    | 'buyer_email'
    | 'buyer_name'
    | 'subtotal_cents'
    | 'discount_cents'
    | 'total_cents'
    | 'created_at'
  >
  event: PublicEvent
  tickets: Array<{
    id: string
    typeName: string
    status: TicketRow['status']
    qrDataUrl: string
    qrToken: string
    googleSaveUrl: string | null
    appleAvailable: boolean
  }>
}

/**
 * Load an order for the buyer's status page. Verifies the signed token, and if
 * the order is still pending, reconciles against GoPay (covers a delayed/missed
 * webhook) before returning.
 */
export async function getOrderView(
  orderId: string,
  token: string,
): Promise<OrderView | null> {
  const db = serviceClient()
  let { data: order } = await db
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle<OrderRow>()
  if (!order) return null

  const { data: event } = await db
    .from('events')
    .select('*')
    .eq('id', order.event_id)
    .single<EventRow>()
  if (!event) return null

  if (!verifyOrderToken(order.id, token, event.qr_secret)) return null

  // Reconcile a pending payment on demand.
  if (
    order.status === 'pending' &&
    order.gopay_payment_id &&
    isGoPayConfigured()
  ) {
    try {
      await reconcileGoPay(order, event)
      const { data: fresh } = await db
        .from('orders')
        .select('*')
        .eq('id', order.id)
        .single<OrderRow>()
      if (fresh) order = fresh
    } catch {
      // network hiccup — show current state, cron/webhook will catch up
    }
  }

  const { data: ticketRows } = await db
    .from('tickets')
    .select('*')
    .eq('order_id', order.id)
    .returns<TicketRow[]>()
  const names = await ticketTypeNames(
    (ticketRows ?? []).map((t) => t.ticket_type_id),
  )

  const appleAvailable = appleWalletConfigured()
  const whenLabel = formatEventDate(event.starts_at, event.timezone)
  const tickets = await Promise.all(
    (ticketRows ?? []).map(async (t) => {
      const qrToken = signTicket(t.id, event.qr_secret)
      const typeName = names.get(t.ticket_type_id) ?? 'Vstupenka'
      return {
        id: t.id,
        typeName,
        status: t.status,
        qrToken,
        qrDataUrl: await qrDataUrl(qrToken),
        googleSaveUrl: googleWalletSaveUrl({
          ticketId: t.id,
          eventId: event.id,
          ref: t.id.slice(0, 8).toUpperCase(),
          eventTitle: event.title,
          whenLabel,
          startsAtIso: event.starts_at,
          venue: event.venue_name,
          ticketTypeName: typeName,
          holderName: t.holder_name,
          qrToken,
        }),
        appleAvailable,
      }
    }),
  )

  const { qr_secret, ...publicEvent } = event
  return {
    order: {
      id: order.id,
      status: order.status,
      buyer_email: order.buyer_email,
      buyer_name: order.buyer_name,
      subtotal_cents: order.subtotal_cents,
      discount_cents: order.discount_cents,
      total_cents: order.total_cents,
      created_at: order.created_at,
    },
    event: publicEvent,
    tickets,
  }
}

/**
 * Render a single ticket's PDF for the buyer download link. Verifies the order
 * token and that the ticket belongs to the order. Returns null on any mismatch.
 */
export async function getTicketPdf(
  orderId: string,
  ticketId: string,
  token: string,
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const db = serviceClient()
  const { data: ticket } = await db
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .eq('order_id', orderId)
    .maybeSingle<TicketRow>()
  if (!ticket) return null

  const { data: event } = await db
    .from('events')
    .select('*')
    .eq('id', ticket.event_id)
    .single<EventRow>()
  if (!event) return null

  if (!verifyOrderToken(orderId, token, event.qr_secret)) return null

  const names = await ticketTypeNames([ticket.ticket_type_id])
  const bytes = await renderTicketPdf({
    eventTitle: event.title,
    venue: event.venue_name,
    startsAtLabel: formatEventDate(event.starts_at, event.timezone),
    ticketTypeName: names.get(ticket.ticket_type_id) ?? 'Vstupenka',
    holderName: ticket.holder_name,
    ticketRef: ticket.id.slice(0, 8).toUpperCase(),
    qrToken: signTicket(ticket.id, event.qr_secret),
  })
  return { bytes, filename: `vstupenka-${ticket.id.slice(0, 8)}.pdf` }
}

/**
 * Generate a ticket's Apple Wallet .pkpass for the buyer download link. Verifies
 * the order token; returns null if Apple Wallet isn't configured or on mismatch.
 */
export async function getApplePass(
  orderId: string,
  ticketId: string,
  token: string,
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const db = serviceClient()
  const { data: ticket } = await db
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .eq('order_id', orderId)
    .maybeSingle<TicketRow>()
  if (!ticket) return null

  const { data: event } = await db
    .from('events')
    .select('*')
    .eq('id', ticket.event_id)
    .single<EventRow>()
  if (!event) return null
  if (!verifyOrderToken(orderId, token, event.qr_secret)) return null

  const names = await ticketTypeNames([ticket.ticket_type_id])
  const bytes = await generateApplePkpass({
    ticketId: ticket.id,
    eventId: event.id,
    ref: ticket.id.slice(0, 8).toUpperCase(),
    eventTitle: event.title,
    whenLabel: formatEventDate(event.starts_at, event.timezone),
    startsAtIso: event.starts_at,
    venue: event.venue_name,
    ticketTypeName: names.get(ticket.ticket_type_id) ?? 'Vstupenka',
    holderName: ticket.holder_name,
    qrToken: signTicket(ticket.id, event.qr_secret),
  })
  if (!bytes) return null
  return { bytes, filename: `vstupenka-${ticket.id.slice(0, 8)}.pkpass` }
}

async function reconcileGoPay(order: OrderRow, event: EventRow): Promise<void> {
  if (!order.gopay_payment_id) return
  const status = await getPaymentStatus(order.gopay_payment_id)
  await recordPaymentEvent(
    order.id,
    order.gopay_payment_id,
    status.state,
    status,
  )

  // Every action is idempotent (guarded on the current order status), so a
  // repeated notification or an out-of-order transition is safe.
  switch (gopayStateToAction(status.state)) {
    case 'fulfill':
      await markPaidAndFulfill(order, event)
      break
    case 'refund_full':
      await syncFullRefund(order)
      break
    case 'refund_partial':
      await syncPartialRefund(order)
      break
    case 'cancel':
      await cancelUnpaidOrder(order)
      break
    case 'none':
      break
  }
}

/** Sum of non-failed refunds already booked against an order. */
async function refundedTotal(orderId: string): Promise<number> {
  const { data } = await serviceClient()
    .from('refunds')
    .select('amount_cents, status')
    .eq('order_id', orderId)
    .returns<{ amount_cents: number; status: string }[]>()
  return (data ?? [])
    .filter((r) => r.status !== 'failed')
    .reduce((s, r) => s + r.amount_cents, 0)
}

/**
 * GoPay reports the payment fully REFUNDED. Sync our DB idempotently WITHOUT
 * calling the gateway again (the refund already happened at GoPay — this may be
 * our own UI refund confirming, or one done in the GoPay portal). Records the
 * remaining amount as a refund row so settlement accounting stays consistent.
 */
async function syncFullRefund(order: OrderRow): Promise<void> {
  if (order.status === 'refunded') return
  if (order.status !== 'paid' && order.status !== 'partially_refunded') return
  const db = serviceClient()

  const remaining = order.total_cents - (await refundedTotal(order.id))
  if (remaining > 0) {
    await db.from('refunds').insert({
      order_id: order.id,
      ticket_id: null,
      amount_cents: remaining,
      gopay_refund_id: order.gopay_payment_id,
      status: 'done',
      reason: 'GoPay refund (webhook)',
      created_by: null,
    })
  }

  const { data: tickets } = await db
    .from('tickets')
    .select('id, ticket_type_id, status')
    .eq('order_id', order.id)
    .neq('status', 'cancelled')
    .returns<{ id: string; ticket_type_id: string; status: string }[]>()
  for (const t of tickets ?? []) {
    await db.from('tickets').update({ status: 'cancelled' }).eq('id', t.id)
    await db
      .rpc('release_ticket_capacity', {
        p_ticket_type_id: t.ticket_type_id,
        p_qty: 1,
      })
      .then(
        () => undefined,
        () => undefined,
      )
  }

  await db.from('orders').update({ status: 'refunded' }).eq('id', order.id)
}

/**
 * GoPay reports PARTIALLY_REFUNDED. If we initiated the partial the order is
 * already 'partially_refunded' (and the amount is in the refunds ledger); this
 * only advances a still-'paid' order that was partially refunded in the GoPay
 * portal. The exact amount/tickets aren't derivable from the state alone, so we
 * record only the status transition.
 */
async function syncPartialRefund(order: OrderRow): Promise<void> {
  if (order.status !== 'paid') return
  await serviceClient()
    .from('orders')
    .update({ status: 'partially_refunded' })
    .eq('id', order.id)
}

/** GoPay CANCELED / TIMEOUTED: drop an unpaid reservation and free its capacity. */
async function cancelUnpaidOrder(order: OrderRow): Promise<void> {
  if (order.status !== 'pending') return
  const db = serviceClient()

  const { data: items } = await db
    .from('order_items')
    .select('ticket_type_id, quantity')
    .eq('order_id', order.id)
    .returns<{ ticket_type_id: string; quantity: number }[]>()
  for (const it of items ?? []) {
    await db
      .rpc('release_ticket_capacity', {
        p_ticket_type_id: it.ticket_type_id,
        p_qty: it.quantity,
      })
      .then(
        () => undefined,
        () => undefined,
      )
  }

  await db.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
}

/** Idempotent webhook entry point: called by /api/gopay/notify. */
export async function handleGoPayNotification(
  paymentId: string,
): Promise<void> {
  const db = serviceClient()
  const { data: order } = await db
    .from('orders')
    .select('*')
    .eq('gopay_payment_id', paymentId)
    .maybeSingle<OrderRow>()
  if (!order) return

  const { data: event } = await db
    .from('events')
    .select('*')
    .eq('id', order.event_id)
    .single<EventRow>()
  if (!event) return

  await reconcileGoPay(order, event)
}

async function recordPaymentEvent(
  orderId: string,
  paymentId: string,
  state: string,
  raw: unknown,
): Promise<void> {
  const db = serviceClient()
  // unique(gopay_payment_id, state) makes this the idempotency guard.
  await db
    .from('payment_events')
    .insert({ order_id: orderId, gopay_payment_id: paymentId, state, raw })
    .then(
      () => undefined,
      () => undefined, // duplicate (already processed this state) — ignore
    )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildOrderUrl(orderId: string, token: string): string {
  return `${getEnv().APP_URL}/order/${orderId}?t=${encodeURIComponent(token)}`
}

function formatEventDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso))
}
