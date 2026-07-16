/**
 * Organizer dashboard server functions. Every mutation verifies the caller's
 * membership in organizer_members and that the target resource belongs to their
 * organizer. Writes use the service client; authorization is enforced here, in
 * code (not via RLS), consistent with the rest of the app.
 *
 * Money is integer cents. Times come from the client as `datetime-local` wall
 * time in the event timezone and are stored as UTC.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getCurrentUser } from '../lib/supabase/auth'
import { serviceClient } from '../lib/supabase/server'
import { slugify } from '../lib/slug'
import { normalizeHexColor, detectImageKind } from '../lib/tickets/branding'
import { generateApiKey } from '../lib/api-keys'
import { zonedLocalToUtcIso } from '../lib/datetime'
import { buildSalesData } from './sales-data'
import type { SalesData } from './sales-data'
import { getCheckinSummary } from './checkin-service'
import { notifyEventChanged } from './event-emails'
import type {
  EventRow,
  TicketTypeRow,
  CouponRow,
  EventStatus,
} from '../lib/db-types'

class DashboardError extends Error {}

interface Actor {
  userId: string
  organizerId: string
  role: 'owner' | 'admin' | 'checkin'
}

async function requireOrganizer(): Promise<Actor> {
  const user = await getCurrentUser()
  if (!user) throw new DashboardError('Neprihlásený.')
  const { data } = await serviceClient()
    .from('organizer_members')
    .select('organizer_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle<{ organizer_id: string; role: Actor['role'] }>()
  if (!data) throw new DashboardError('Nie ste členom žiadneho organizátora.')
  return { userId: user.id, organizerId: data.organizer_id, role: data.role }
}

/** Editors: owner + admin. Check-in role may not manage events. */
function assertCanEdit(actor: Actor): void {
  if (actor.role === 'checkin') {
    throw new DashboardError('Na túto akciu nemáte oprávnenie.')
  }
}

async function assertEventOwned(
  organizerId: string,
  eventId: string,
): Promise<EventRow> {
  const { data } = await serviceClient()
    .from('events')
    .select('*')
    .eq('id', eventId)
    .eq('organizer_id', organizerId)
    .maybeSingle<EventRow>()
  if (!data)
    throw new DashboardError(
      'Podujatie sa nenašlo alebo naň nemáte oprávnenie.',
    )
  return data
}

async function eventOfTicketType(ticketTypeId: string): Promise<string> {
  const { data } = await serviceClient()
    .from('ticket_types')
    .select('event_id')
    .eq('id', ticketTypeId)
    .maybeSingle<{ event_id: string }>()
  if (!data) throw new DashboardError('Typ vstupenky sa nenašiel.')
  return data.event_id
}

async function eventOfCoupon(couponId: string): Promise<string> {
  const { data } = await serviceClient()
    .from('coupons')
    .select('event_id')
    .eq('id', couponId)
    .maybeSingle<{ event_id: string }>()
  if (!data) throw new DashboardError('Kupón sa nenašiel.')
  return data.event_id
}

async function uniqueEventSlug(base: string): Promise<string> {
  const db = serviceClient()
  const root = slugify(base) || 'podujatie'
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`
    const { data } = await db
      .from('events')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()
    if (!data) return candidate
  }
  return `${root}-${Date.now()}`
}

/** Wrap a handler so DashboardError surfaces as { error } instead of a 500. */
async function run<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof DashboardError) return { error: e.message }
    throw e
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface MyEventSummary {
  id: string
  title: string
  slug: string
  status: EventStatus
  starts_at: string
  timezone: string
  ticketTypeCount: number
  soldCount: number
  capacity: number
}

export const listMyEventsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MyEventSummary[]> => {
    const actor = await requireOrganizer()
    const db = serviceClient()
    const { data: events } = await db
      .from('events')
      .select('id, title, slug, status, starts_at, timezone')
      .eq('organizer_id', actor.organizerId)
      .order('starts_at', { ascending: false })
      .returns<
        Pick<
          EventRow,
          'id' | 'title' | 'slug' | 'status' | 'starts_at' | 'timezone'
        >[]
      >()

    const list = events ?? []
    const summaries = await Promise.all(
      list.map(async (e) => {
        const { data: types } = await db
          .from('ticket_types')
          .select('sold_count, capacity')
          .eq('event_id', e.id)
          .returns<Pick<TicketTypeRow, 'sold_count' | 'capacity'>[]>()
        const t = types ?? []
        return {
          ...e,
          ticketTypeCount: t.length,
          soldCount: t.reduce((s, x) => s + x.sold_count, 0),
          capacity: t.reduce((s, x) => s + x.capacity, 0),
        }
      }),
    )
    return summaries
  },
)

export interface EventDetail {
  event: EventRow
  ticketTypes: TicketTypeRow[]
  coupons: CouponRow[]
}

export const getMyEventFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<EventDetail | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      const event = await assertEventOwned(actor.organizerId, data.eventId)
      const db = serviceClient()
      const [{ data: ticketTypes }, { data: coupons }] = await Promise.all([
        db
          .from('ticket_types')
          .select('*')
          .eq('event_id', event.id)
          .order('sort_order', { ascending: true })
          .returns<TicketTypeRow[]>(),
        db
          .from('coupons')
          .select('*')
          .eq('event_id', event.id)
          .order('code', { ascending: true })
          .returns<CouponRow[]>(),
      ])
      return { event, ticketTypes: ticketTypes ?? [], coupons: coupons ?? [] }
    })
  })

const eventInput = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  venueName: z.string().trim().max(200).optional().nullable(),
  venueAddress: z.string().trim().max(300).optional().nullable(),
  startsAtLocal: z.string().min(1),
  endsAtLocal: z.string().optional().nullable(),
  timezone: z.string().default('Europe/Bratislava'),
  ga4MeasurementId: z.string().trim().max(40).optional().nullable(),
  metaPixelId: z.string().trim().max(40).optional().nullable(),
})

export const createEventFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => eventInput.parse(d))
  .handler(async ({ data }) => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      const slug = await uniqueEventSlug(data.title)
      const { data: created, error } = await serviceClient()
        .from('events')
        .insert({
          organizer_id: actor.organizerId,
          title: data.title,
          slug,
          description: data.description ?? null,
          venue_name: data.venueName ?? null,
          venue_address: data.venueAddress ?? null,
          starts_at: zonedLocalToUtcIso(data.startsAtLocal, data.timezone),
          ends_at: data.endsAtLocal
            ? zonedLocalToUtcIso(data.endsAtLocal, data.timezone)
            : null,
          timezone: data.timezone,
          ga4_measurement_id: data.ga4MeasurementId ?? null,
          meta_pixel_id: data.metaPixelId ?? null,
          status: 'draft',
        })
        .select('id')
        .single<{ id: string }>()
      if (error || !created)
        throw new DashboardError('Podujatie sa nepodarilo vytvoriť.')
      return { ok: true, eventId: created.id }
    })
  })

export const updateEventFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    eventInput.extend({ eventId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      const event = await assertEventOwned(actor.organizerId, data.eventId)

      const newStartsAt = zonedLocalToUtcIso(data.startsAtLocal, data.timezone)
      const newEndsAt = data.endsAtLocal
        ? zonedLocalToUtcIso(data.endsAtLocal, data.timezone)
        : null
      const newVenueName = data.venueName ?? null
      const newVenueAddress = data.venueAddress ?? null

      const { error } = await serviceClient()
        .from('events')
        .update({
          title: data.title,
          description: data.description ?? null,
          venue_name: newVenueName,
          venue_address: newVenueAddress,
          starts_at: newStartsAt,
          ends_at: newEndsAt,
          timezone: data.timezone,
          ga4_measurement_id: data.ga4MeasurementId ?? null,
          meta_pixel_id: data.metaPixelId ?? null,
        })
        .eq('id', event.id)
      if (error) throw new DashboardError('Podujatie sa nepodarilo uložiť.')

      // Notify paid buyers if the date/venue changed (best-effort).
      await notifyEventChanged(event, {
        newStartsAt,
        newEndsAt,
        newVenueName,
        newVenueAddress,
      }).catch(() => undefined)

      return { ok: true }
    })
  })

async function setEventStatus(eventId: string, status: EventStatus) {
  return run(async () => {
    const actor = await requireOrganizer()
    assertCanEdit(actor)
    const event = await assertEventOwned(actor.organizerId, eventId)
    // A suspended organizer may not publish (they may still unpublish to draft).
    if (status === 'published') {
      const { data: org } = await serviceClient()
        .from('organizers')
        .select('status')
        .eq('id', actor.organizerId)
        .maybeSingle<{ status: 'active' | 'suspended' }>()
      if (org?.status === 'suspended') {
        throw new DashboardError(
          'Váš účet je pozastavený, podujatie nie je možné zverejniť. Kontaktujte podporu.',
        )
      }
    }
    const { error } = await serviceClient()
      .from('events')
      .update({ status })
      .eq('id', event.id)
    if (error) throw new DashboardError('Zmena stavu zlyhala.')
    return { ok: true, status }
  })
}

export const publishEventFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => setEventStatus(data.eventId, 'published'))

export const unpublishEventFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => setEventStatus(data.eventId, 'draft'))

// ---------------------------------------------------------------------------
// Ticket types
// ---------------------------------------------------------------------------

const customFieldSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(120),
  type: z.enum(['text', 'select', 'checkbox']),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
})

const ticketTypeInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  priceCents: z.number().int().min(0),
  capacity: z.number().int().min(0),
  maxPerOrder: z.number().int().min(1).max(100).default(10),
  sortOrder: z.number().int().default(0),
  hidden: z.boolean().default(false),
  customFields: z.array(customFieldSchema).max(20).default([]),
})

export const createTicketTypeFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    ticketTypeInput.extend({ eventId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      await assertEventOwned(actor.organizerId, data.eventId)
      const { error } = await serviceClient()
        .from('ticket_types')
        .insert({
          event_id: data.eventId,
          name: data.name,
          description: data.description ?? null,
          price_cents: data.priceCents,
          capacity: data.capacity,
          max_per_order: data.maxPerOrder,
          sort_order: data.sortOrder,
          hidden: data.hidden,
          custom_fields: data.customFields,
        })
      if (error)
        throw new DashboardError('Typ vstupenky sa nepodarilo vytvoriť.')
      return { ok: true }
    })
  })

export const updateTicketTypeFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    ticketTypeInput.extend({ ticketTypeId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      const eventId = await eventOfTicketType(data.ticketTypeId)
      await assertEventOwned(actor.organizerId, eventId)
      const { error } = await serviceClient()
        .from('ticket_types')
        .update({
          name: data.name,
          description: data.description ?? null,
          price_cents: data.priceCents,
          capacity: data.capacity,
          max_per_order: data.maxPerOrder,
          sort_order: data.sortOrder,
          hidden: data.hidden,
          custom_fields: data.customFields,
        })
        .eq('id', data.ticketTypeId)
      if (error) throw new DashboardError('Typ vstupenky sa nepodarilo uložiť.')
      return { ok: true }
    })
  })

export const deleteTicketTypeFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z.object({ ticketTypeId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      const eventId = await eventOfTicketType(data.ticketTypeId)
      await assertEventOwned(actor.organizerId, eventId)
      const { error } = await serviceClient()
        .from('ticket_types')
        .delete()
        .eq('id', data.ticketTypeId)
      if (error) {
        // FK violation: the type already has orders/tickets.
        if (error.code === '23503') {
          throw new DashboardError(
            'Typ má predané vstupenky — namiesto zmazania ho skryte.',
          )
        }
        throw new DashboardError('Typ vstupenky sa nepodarilo zmazať.')
      }
      return { ok: true }
    })
  })

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

const couponInput = z
  .object({
    code: z.string().trim().min(1).max(64),
    type: z.enum(['percent', 'fixed']),
    value: z.number().int().min(0),
    maxUses: z.number().int().min(1).optional().nullable(),
    validFromLocal: z.string().optional().nullable(),
    validUntilLocal: z.string().optional().nullable(),
    timezone: z.string().default('Europe/Bratislava'),
  })
  .refine((v) => v.type !== 'percent' || v.value <= 100, {
    message: 'Percentuálna zľava môže byť najviac 100.',
    path: ['value'],
  })

function couponTimes(data: z.infer<typeof couponInput>) {
  return {
    valid_from: data.validFromLocal
      ? zonedLocalToUtcIso(data.validFromLocal, data.timezone)
      : null,
    valid_until: data.validUntilLocal
      ? zonedLocalToUtcIso(data.validUntilLocal, data.timezone)
      : null,
  }
}

export const createCouponFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    couponInput.and(z.object({ eventId: z.string().uuid() })).parse(d),
  )
  .handler(async ({ data }) => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      await assertEventOwned(actor.organizerId, data.eventId)
      const { error } = await serviceClient()
        .from('coupons')
        .insert({
          event_id: data.eventId,
          code: data.code,
          type: data.type,
          value: data.value,
          max_uses: data.maxUses ?? null,
          ...couponTimes(data),
        })
      if (error) {
        if (error.code === '23505') {
          throw new DashboardError(
            'Kupón s týmto kódom už pre podujatie existuje.',
          )
        }
        throw new DashboardError('Kupón sa nepodarilo vytvoriť.')
      }
      return { ok: true }
    })
  })

export const updateCouponFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    couponInput.and(z.object({ couponId: z.string().uuid() })).parse(d),
  )
  .handler(async ({ data }) => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      const eventId = await eventOfCoupon(data.couponId)
      await assertEventOwned(actor.organizerId, eventId)
      const { error } = await serviceClient()
        .from('coupons')
        .update({
          code: data.code,
          type: data.type,
          value: data.value,
          max_uses: data.maxUses ?? null,
          ...couponTimes(data),
        })
        .eq('id', data.couponId)
      if (error) {
        if (error.code === '23505') {
          throw new DashboardError(
            'Kupón s týmto kódom už pre podujatie existuje.',
          )
        }
        throw new DashboardError('Kupón sa nepodarilo uložiť.')
      }
      return { ok: true }
    })
  })

export const deleteCouponFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ couponId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      const eventId = await eventOfCoupon(data.couponId)
      await assertEventOwned(actor.organizerId, eventId)
      const { error } = await serviceClient()
        .from('coupons')
        .delete()
        .eq('id', data.couponId)
      if (error) throw new DashboardError('Kupón sa nepodarilo zmazať.')
      return { ok: true }
    })
  })

// ---------------------------------------------------------------------------
// Sales (data building lives in ./sales-data, which is auth/client-free)
// ---------------------------------------------------------------------------

export type { SalesData, SalesOrder } from './sales-data'

export const getEventSalesFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<SalesData | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      const sales = await buildSalesData(data.eventId, actor.organizerId)
      if (!sales)
        throw new DashboardError(
          'Podujatie sa nenašlo alebo naň nemáte oprávnenie.',
        )
      return sales
    })
  })

// ---------------------------------------------------------------------------
// Check-in (scan processing lives in ./checkin-service; the POST /api/checkin
// route is the scanning endpoint. This fn only backs the board's initial load.)
// ---------------------------------------------------------------------------

export interface CheckinBoard {
  event: { id: string; title: string; slug: string; timezone: string }
  summary: { total: number; checkedIn: number }
}

/** Event header + admitted/total counters for the check-in board. Any member
 *  (owner, admin or the dedicated checkin role) may open it. */
export const getCheckinBoardFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<CheckinBoard | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      const event = await assertEventOwned(actor.organizerId, data.eventId)
      const summary = (await getCheckinSummary(
        data.eventId,
        actor.organizerId,
      )) ?? {
        total: 0,
        checkedIn: 0,
      }
      return {
        event: {
          id: event.id,
          title: event.title,
          slug: event.slug,
          timezone: event.timezone,
        },
        summary,
      }
    })
  })

// ---------------------------------------------------------------------------
// Organizer branding (logo + accent color) — used on ticket PDFs.
// ---------------------------------------------------------------------------

const BRANDING_BUCKET = 'branding'
const MAX_LOGO_BYTES = 512 * 1024 // 512 KB

export interface OrganizerBranding {
  name: string
  brandColor: string | null
  brandLogoUrl: string | null
}

export const getOrganizerBrandingFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<OrganizerBranding> => {
    const actor = await requireOrganizer()
    const { data } = await serviceClient()
      .from('organizers')
      .select('name, brand_color, brand_logo_url')
      .eq('id', actor.organizerId)
      .maybeSingle<{
        name: string
        brand_color: string | null
        brand_logo_url: string | null
      }>()
    return {
      name: data?.name ?? '',
      brandColor: data?.brand_color ?? null,
      brandLogoUrl: data?.brand_logo_url ?? null,
    }
  },
)

export const updateBrandColorFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({ brandColor: z.string().trim().max(7).nullable() }).parse,
  )
  .handler(async ({ data }) => {
    const actor = await requireOrganizer()
    assertCanEdit(actor)
    let color: string | null = null
    if (data.brandColor) {
      color = normalizeHexColor(data.brandColor)
      if (!color) throw new DashboardError('Neplatná farba (očakávam #rrggbb).')
    }
    await serviceClient()
      .from('organizers')
      .update({ brand_color: color })
      .eq('id', actor.organizerId)
    return { ok: true as const, brandColor: color }
  })

/** Upload a logo from a base64 data URL. Validates type (PNG/JPEG) + size. */
export const uploadBrandLogoFn = createServerFn({ method: 'POST' })
  .validator(z.object({ dataUrl: z.string().max(1_400_000) }).parse)
  .handler(async ({ data }) => {
    const actor = await requireOrganizer()
    assertCanEdit(actor)

    const comma = data.dataUrl.indexOf(',')
    const b64 = comma >= 0 ? data.dataUrl.slice(comma + 1) : data.dataUrl
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(Buffer.from(b64, 'base64'))
    } catch {
      throw new DashboardError('Neplatný súbor.')
    }
    if (bytes.length === 0) throw new DashboardError('Prázdny súbor.')
    if (bytes.length > MAX_LOGO_BYTES) {
      throw new DashboardError('Logo je príliš veľké (max 512 KB).')
    }
    const kind = detectImageKind(bytes)
    if (!kind) throw new DashboardError('Podporované sú len PNG a JPG.')

    const db = serviceClient()
    const ext = kind === 'png' ? 'png' : 'jpg'
    const path = `${actor.organizerId}/logo.${ext}`
    const { error: upErr } = await db.storage
      .from(BRANDING_BUCKET)
      .upload(path, bytes, {
        contentType: kind === 'png' ? 'image/png' : 'image/jpeg',
        upsert: true,
      })
    if (upErr) throw new DashboardError('Nahrávanie zlyhalo.')

    // Remove the other extension if the organizer switched formats.
    const otherExt = ext === 'png' ? 'jpg' : 'png'
    await db.storage
      .from(BRANDING_BUCKET)
      .remove([`${actor.organizerId}/logo.${otherExt}`])
      .then(
        () => undefined,
        () => undefined,
      )

    const {
      data: { publicUrl },
    } = db.storage.from(BRANDING_BUCKET).getPublicUrl(path)
    const url = `${publicUrl}?v=${Date.now()}`
    await db
      .from('organizers')
      .update({ brand_logo_url: url })
      .eq('id', actor.organizerId)
    return { ok: true as const, brandLogoUrl: url }
  })

export const removeBrandLogoFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    const actor = await requireOrganizer()
    assertCanEdit(actor)
    const db = serviceClient()
    await db.storage
      .from(BRANDING_BUCKET)
      .remove([
        `${actor.organizerId}/logo.png`,
        `${actor.organizerId}/logo.jpg`,
      ])
      .then(
        () => undefined,
        () => undefined,
      )
    await db
      .from('organizers')
      .update({ brand_logo_url: null })
      .eq('id', actor.organizerId)
    return { ok: true as const }
  },
)

// ---------------------------------------------------------------------------
// API keys (public REST API access).
// ---------------------------------------------------------------------------

export interface ApiKeySummary {
  id: string
  name: string
  keyPrefix: string
  lastUsedAt: string | null
  createdAt: string
  revokedAt: string | null
}

export const listApiKeysFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ApiKeySummary[]> => {
    const actor = await requireOrganizer()
    const { data } = await serviceClient()
      .from('api_keys')
      .select('id, name, key_prefix, last_used_at, created_at, revoked_at')
      .eq('organizer_id', actor.organizerId)
      .order('created_at', { ascending: false })
      .returns<
        {
          id: string
          name: string
          key_prefix: string
          last_used_at: string | null
          created_at: string
          revoked_at: string | null
        }[]
      >()
    return (data ?? []).map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.key_prefix,
      lastUsedAt: k.last_used_at,
      createdAt: k.created_at,
      revokedAt: k.revoked_at,
    }))
  },
)

/** Create a key. Returns the plaintext key ONCE — it is never stored or shown again. */
export const createApiKeyFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({ name: z.string().trim().max(80).default('API kľúč') }).parse,
  )
  .handler(async ({ data }) => {
    const actor = await requireOrganizer()
    assertCanEdit(actor)
    const gen = generateApiKey()
    const { error } = await serviceClient()
      .from('api_keys')
      .insert({
        organizer_id: actor.organizerId,
        name: data.name || 'API kľúč',
        key_prefix: gen.prefix,
        key_hash: gen.hash,
      })
    if (error) throw new DashboardError('Kľúč sa nepodarilo vytvoriť.')
    return { key: gen.key, prefix: gen.prefix }
  })

export const revokeApiKeyFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }).parse)
  .handler(async ({ data }) => {
    const actor = await requireOrganizer()
    assertCanEdit(actor)
    await serviceClient()
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', data.id)
      .eq('organizer_id', actor.organizerId)
    return { ok: true as const }
  })
