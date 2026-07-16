/**
 * Public REST API v1 read model. Query helpers are scoped to the authenticated
 * organizer; serializers are pure and shape the stable public JSON. Route
 * handlers stay thin (auth via withApiKey, then call these).
 *
 * Server-only.
 */

export interface ApiDb {
  from: (t: string) => any
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

export interface ListParams {
  limit: number
  offset: number
}

/** Parse & clamp limit/offset from URL search params. */
export function parseListParams(sp: URLSearchParams): ListParams {
  const rawLimit = Number(sp.get('limit'))
  const rawOffset = Number(sp.get('offset'))
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(MAX_LIMIT, Math.floor(rawLimit))
      : DEFAULT_LIMIT
  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0
  return { limit, offset }
}

const ref = (id: string) => id.slice(0, 8).toUpperCase()

// -- serializers (pure) -----------------------------------------------------

export function serializeEvent(
  e: Record<string, any>,
): Record<string, unknown> {
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    status: e.status,
    starts_at: e.starts_at,
    ends_at: e.ends_at ?? null,
    timezone: e.timezone,
    venue_name: e.venue_name ?? null,
    venue_address: e.venue_address ?? null,
    created_at: e.created_at ?? null,
  }
}

export function serializeTicketType(
  t: Record<string, any>,
): Record<string, unknown> {
  return {
    id: t.id,
    name: t.name,
    price_cents: t.price_cents,
    currency: t.currency ?? 'EUR',
    capacity: t.capacity,
    sold_count: t.sold_count,
    hidden: Boolean(t.hidden),
  }
}

export function serializeOrder(
  o: Record<string, any>,
): Record<string, unknown> {
  return {
    id: o.id,
    ref: ref(o.id),
    event_id: o.event_id,
    status: o.status,
    buyer_email: o.buyer_email,
    buyer_name: o.buyer_name ?? null,
    subtotal_cents: o.subtotal_cents,
    discount_cents: o.discount_cents,
    total_cents: o.total_cents,
    currency: 'EUR',
    created_at: o.created_at,
    paid_at: o.paid_at ?? null,
  }
}

export function serializeTicket(
  t: Record<string, any>,
): Record<string, unknown> {
  return {
    id: t.id,
    ref: ref(t.id),
    order_id: t.order_id,
    ticket_type_id: t.ticket_type_id,
    event_id: t.event_id,
    holder_name: t.holder_name ?? null,
    status: t.status,
    checked_in: t.status === 'used',
    checked_in_at: t.used_at ?? null,
  }
}

// -- scoped queries ---------------------------------------------------------

/** Ids of the organizer's events (used to scope orders/tickets). */
async function organizerEventIds(
  db: ApiDb,
  organizerId: string,
): Promise<string[]> {
  const { data } = await db
    .from('events')
    .select('id')
    .eq('organizer_id', organizerId)
  return ((data as { id: string }[] | null) ?? []).map((e) => e.id)
}

export async function listEvents(
  db: ApiDb,
  organizerId: string,
  opts: ListParams & { status?: string | null },
): Promise<Record<string, unknown>[]> {
  let q = db
    .from('events')
    .select(
      'id, slug, title, status, starts_at, ends_at, timezone, venue_name, venue_address, created_at',
    )
    .eq('organizer_id', organizerId)
  if (opts.status) q = q.eq('status', opts.status)
  const { data } = await q
    .order('starts_at', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1)
  return ((data as Record<string, any>[] | null) ?? []).map(serializeEvent)
}

/** Event detail + ticket types, or null if not owned by the organizer. */
export async function getEvent(
  db: ApiDb,
  organizerId: string,
  eventId: string,
): Promise<Record<string, unknown> | null> {
  const { data: event } = await db
    .from('events')
    .select(
      'id, slug, title, status, starts_at, ends_at, timezone, venue_name, venue_address, created_at',
    )
    .eq('id', eventId)
    .eq('organizer_id', organizerId)
    .maybeSingle()
  if (!event) return null

  const { data: types } = await db
    .from('ticket_types')
    .select('id, name, price_cents, currency, capacity, sold_count, hidden')
    .eq('event_id', eventId)
    .order('sort_order', { ascending: true })
  return {
    ...serializeEvent(event as Record<string, any>),
    ticket_types: ((types as Record<string, any>[] | null) ?? []).map(
      serializeTicketType,
    ),
  }
}

export async function listOrders(
  db: ApiDb,
  organizerId: string,
  opts: ListParams & { status?: string | null; eventId?: string | null },
): Promise<Record<string, unknown>[]> {
  const eventIds = await organizerEventIds(db, organizerId)
  const scope = opts.eventId
    ? eventIds.filter((id) => id === opts.eventId)
    : eventIds
  if (scope.length === 0) return []

  let q = db
    .from('orders')
    .select(
      'id, event_id, status, buyer_email, buyer_name, subtotal_cents, discount_cents, total_cents, created_at, paid_at',
    )
    .in('event_id', scope)
  if (opts.status) q = q.eq('status', opts.status)
  const { data } = await q
    .order('created_at', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1)
  return ((data as Record<string, any>[] | null) ?? []).map(serializeOrder)
}

/** Tickets of one owned event with check-in status, or null if not owned. */
export async function listEventTickets(
  db: ApiDb,
  organizerId: string,
  eventId: string,
  opts: ListParams & { status?: string | null },
): Promise<Record<string, unknown>[] | null> {
  const { data: event } = await db
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('organizer_id', organizerId)
    .maybeSingle()
  if (!event) return null

  let q = db
    .from('tickets')
    .select(
      'id, order_id, ticket_type_id, event_id, holder_name, status, used_at',
    )
    .eq('event_id', eventId)
  if (opts.status) q = q.eq('status', opts.status)
  const { data } = await q.range(opts.offset, opts.offset + opts.limit - 1)
  return ((data as Record<string, any>[] | null) ?? []).map(serializeTicket)
}
