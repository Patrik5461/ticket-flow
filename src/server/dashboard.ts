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
import { settlementNet } from '../lib/settlement-math'
import { detectCoverMime, coverExt } from '../lib/images'
import { isValidIco, isValidIban, normalizeIban } from '../lib/validation'
import { writeAuditLog } from './admin'
import { getImpersonation } from './impersonation-session'
import { generateWebhookSecret, WEBHOOK_EVENT_TYPES } from '../lib/webhooks'
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
  /** True when a platform admin is viewing this organizer read-only. */
  impersonating?: boolean
}

async function requireOrganizer(): Promise<Actor> {
  const user = await getCurrentUser()
  if (!user) throw new DashboardError('Neprihlásený.')

  // Impersonation: a platform admin views this organizer's dashboard read-only.
  const imp = await getImpersonation(user)
  if (imp) {
    return {
      userId: user.id,
      organizerId: imp.organizerId,
      role: 'owner',
      impersonating: true,
    }
  }

  const { data } = await serviceClient()
    .from('organizer_members')
    .select('organizer_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle<{ organizer_id: string; role: Actor['role'] }>()
  if (!data) throw new DashboardError('Nie ste členom žiadneho organizátora.')
  return { userId: user.id, organizerId: data.organizer_id, role: data.role }
}

/** Editors: owner + admin. Check-in role — and read-only impersonation — may not mutate. */
function assertCanEdit(actor: Actor): void {
  if (actor.impersonating) {
    throw new DashboardError(
      'Režim čítania (prezeranie ako organizátor) — zmeny nie sú povolené.',
    )
  }
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
  coverUrl: z.string().trim().max(1000).optional().nullable(),
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
          cover_url: data.coverUrl ?? null,
          status: 'draft',
        })
        .select('id')
        .single<{ id: string }>()
      if (error) throw new DashboardError('Podujatie sa nepodarilo vytvoriť.')
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
          cover_url: data.coverUrl ?? null,
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

/** Toggle per-event re-entry (owner/admin only). */
export const setEventReentryFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({ eventId: z.string().uuid(), allowReentry: z.boolean() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      const event = await assertEventOwned(actor.organizerId, data.eventId)
      const { error } = await serviceClient()
        .from('events')
        .update({ allow_reentry: data.allowReentry })
        .eq('id', event.id)
      if (error) throw new DashboardError('Nastavenie sa nepodarilo uložiť.')
      return { ok: true, allowReentry: data.allowReentry }
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
// Payout requests (organizer side).
// ---------------------------------------------------------------------------

export type PayoutStatus = 'requested' | 'approved' | 'paid' | 'rejected'

export interface PayoutRequestView {
  id: string
  amountCents: number
  status: PayoutStatus
  note: string | null
  createdAt: string
  resolvedAt: string | null
}

export interface PayoutInfo {
  availableCents: number
  requests: PayoutRequestView[]
}

/** Net available to pay out = net of paid orders − non-rejected requests. */
async function computeAvailablePayout(organizerId: string): Promise<number> {
  const db = serviceClient()
  const { data: events } = await db
    .from('events')
    .select('id')
    .eq('organizer_id', organizerId)
    .returns<{ id: string }[]>()
  const eventIds = (events ?? []).map((e) => e.id)

  // Same net formula as settlements (gross − fee − refunded), so the payout
  // "available" figure matches settlement net even with partial refunds.
  let netPaid = 0
  if (eventIds.length > 0) {
    const { data: orders } = await db
      .from('orders')
      .select('id, total_cents, fee_cents')
      .in('event_id', eventIds)
      .in('status', ['paid', 'partially_refunded', 'refunded'])
      .returns<{ id: string; total_cents: number; fee_cents: number }[]>()
    const orderList = orders ?? []
    let refunds: { amount_cents: number; status: string }[] = []
    if (orderList.length > 0) {
      const { data: refundRows } = await db
        .from('refunds')
        .select('amount_cents, status')
        .in(
          'order_id',
          orderList.map((o) => o.id),
        )
        .returns<{ amount_cents: number; status: string }[]>()
      refunds = refundRows ?? []
    }
    netPaid = settlementNet(orderList, refunds)
  }

  const { data: reqs } = await db
    .from('payout_requests')
    .select('amount_cents, status')
    .eq('organizer_id', organizerId)
    .neq('status', 'rejected')
    .returns<{ amount_cents: number; status: string }[]>()
  const reserved = (reqs ?? []).reduce((s, r) => s + r.amount_cents, 0)

  return netPaid - reserved
}

export const getPayoutInfoFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PayoutInfo> => {
    const actor = await requireOrganizer()
    const availableCents = await computeAvailablePayout(actor.organizerId)
    const { data } = await serviceClient()
      .from('payout_requests')
      .select('id, amount_cents, status, note, created_at, resolved_at')
      .eq('organizer_id', actor.organizerId)
      .order('created_at', { ascending: false })
      .returns<
        {
          id: string
          amount_cents: number
          status: PayoutStatus
          note: string | null
          created_at: string
          resolved_at: string | null
        }[]
      >()
    return {
      availableCents,
      requests: (data ?? []).map((r) => ({
        id: r.id,
        amountCents: r.amount_cents,
        status: r.status,
        note: r.note,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
      })),
    }
  },
)

export const requestPayoutFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        amountCents: z.number().int().positive(),
        note: z.string().trim().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      const available = await computeAvailablePayout(actor.organizerId)
      if (data.amountCents > available) {
        throw new DashboardError('Suma presahuje dostupný zostatok.')
      }
      const { error } = await serviceClient()
        .from('payout_requests')
        .insert({
          organizer_id: actor.organizerId,
          amount_cents: data.amountCents,
          status: 'requested',
          note: data.note || null,
          created_by: actor.userId,
        })
      if (error) throw new DashboardError('Žiadosť sa nepodarilo vytvoriť.')

      await writeAuditLog({
        actorId: actor.userId,
        action: 'payout.requested',
        entityType: 'organizer',
        entityId: actor.organizerId,
        newValue: { amount_cents: data.amountCents },
      })
      return { ok: true as const }
    })
  })

// ---------------------------------------------------------------------------
// Organizer dashboard overview (metrics across all events).
// ---------------------------------------------------------------------------

export interface OrganizerOverview {
  soldTickets: number
  grossCents: number
  feeCents: number
  netCents: number
  paidOrderCount: number
}

export const getOrganizerOverviewFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z.object({ period: z.enum(['30d', 'all']).default('30d') }).parse(d),
  )
  .handler(async ({ data }): Promise<OrganizerOverview> => {
    const actor = await requireOrganizer()
    const db = serviceClient()

    const { data: events } = await db
      .from('events')
      .select('id')
      .eq('organizer_id', actor.organizerId)
      .returns<{ id: string }[]>()
    const eventIds = (events ?? []).map((e) => e.id)
    const empty: OrganizerOverview = {
      soldTickets: 0,
      grossCents: 0,
      feeCents: 0,
      netCents: 0,
      paidOrderCount: 0,
    }
    if (eventIds.length === 0) return empty

    const { data: paid } = await db
      .from('orders')
      .select('id, total_cents, fee_cents, paid_at, created_at')
      .in('event_id', eventIds)
      .eq('status', 'paid')
      .returns<
        {
          id: string
          total_cents: number
          fee_cents: number
          paid_at: string | null
          created_at: string
        }[]
      >()

    const cutoff =
      data.period === '30d' ? Date.now() - 30 * 24 * 60 * 60 * 1000 : 0
    const orders = (paid ?? []).filter((o) => {
      const when = new Date(o.paid_at ?? o.created_at).getTime()
      return when >= cutoff
    })

    let grossCents = 0
    let feeCents = 0
    for (const o of orders) {
      grossCents += o.total_cents
      feeCents += o.fee_cents
    }

    let soldTickets = 0
    if (orders.length > 0) {
      const { data: items } = await db
        .from('order_items')
        .select('quantity, order_id')
        .in(
          'order_id',
          orders.map((o) => o.id),
        )
        .returns<{ quantity: number; order_id: string }[]>()
      soldTickets = (items ?? []).reduce((s, i) => s + i.quantity, 0)
    }

    return {
      soldTickets,
      grossCents,
      feeCents,
      netCents: grossCents - feeCents,
      paidOrderCount: orders.length,
    }
  })

// ---------------------------------------------------------------------------
// Organizer company details + team.
// ---------------------------------------------------------------------------

export interface OrganizerCompany {
  name: string
  slug: string
  ico: string | null
  dic: string | null
  icDph: string | null
  iban: string | null
  contactEmail: string | null
  phone: string | null
  address: string | null
}

export const getOrganizerCompanyFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<OrganizerCompany> => {
    const actor = await requireOrganizer()
    const { data } = await serviceClient()
      .from('organizers')
      .select(
        'name, slug, ico, dic, ic_dph, iban, contact_email, phone, address',
      )
      .eq('id', actor.organizerId)
      .maybeSingle<{
        name: string
        slug: string
        ico: string | null
        dic: string | null
        ic_dph: string | null
        iban: string | null
        contact_email: string | null
        phone: string | null
        address: string | null
      }>()
    return {
      name: data?.name ?? '',
      slug: data?.slug ?? '',
      ico: data?.ico ?? null,
      dic: data?.dic ?? null,
      icDph: data?.ic_dph ?? null,
      iban: data?.iban ?? null,
      contactEmail: data?.contact_email ?? null,
      phone: data?.phone ?? null,
      address: data?.address ?? null,
    }
  },
)

const companyInput = z.object({
  name: z.string().trim().min(2).max(200),
  ico: z.string().trim().max(20).optional().nullable(),
  dic: z.string().trim().max(20).optional().nullable(),
  icDph: z.string().trim().max(20).optional().nullable(),
  iban: z.string().trim().max(42).optional().nullable(),
  contactEmail: z.string().trim().email().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
})

export const updateOrganizerCompanyFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => companyInput.parse(d))
  .handler(async ({ data }) => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)

      if (data.ico && !isValidIco(data.ico)) {
        throw new DashboardError('IČO musí mať presne 8 číslic.')
      }
      const iban = data.iban ? normalizeIban(data.iban) : null
      if (iban && !isValidIban(iban)) {
        throw new DashboardError('Neplatný IBAN.')
      }

      const { error } = await serviceClient()
        .from('organizers')
        .update({
          name: data.name,
          ico: data.ico || null,
          dic: data.dic || null,
          ic_dph: data.icDph || null,
          iban,
          contact_email: data.contactEmail || null,
          phone: data.phone || null,
          address: data.address || null,
        })
        .eq('id', actor.organizerId)
      if (error) throw new DashboardError('Údaje sa nepodarilo uložiť.')

      await writeAuditLog({
        actorId: actor.userId,
        action: 'organizer.company_updated',
        entityType: 'organizer',
        entityId: actor.organizerId,
        newValue: {
          name: data.name,
          ico: data.ico || null,
          iban,
          contact_email: data.contactEmail || null,
        },
      })
      return { ok: true as const }
    })
  })

export interface TeamMember {
  email: string
  role: 'owner' | 'admin' | 'checkin'
}

export const listTeamMembersFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TeamMember[]> => {
    const actor = await requireOrganizer()
    const db = serviceClient()
    const { data: members } = await db
      .from('organizer_members')
      .select('user_id, role')
      .eq('organizer_id', actor.organizerId)
      .returns<{ user_id: string; role: TeamMember['role'] }[]>()

    const out: TeamMember[] = []
    for (const m of members ?? []) {
      const { data } = await db.auth.admin.getUserById(m.user_id)
      out.push({ email: data.user?.email ?? '—', role: m.role })
    }
    return out
  },
)

// ---------------------------------------------------------------------------
// Event cover images.
// ---------------------------------------------------------------------------

const EVENT_COVERS_BUCKET = 'event-covers'
const MAX_COVER_BYTES = 5 * 1024 * 1024 // 5 MB

/**
 * Upload an event cover from a base64 data URL. Org-scoped path (independent of a
 * specific event, so it also works in the create flow). Returns the public URL to
 * store in events.cover_url. Validates type (PNG/JPEG/WebP) + size (5 MB).
 */
export const uploadEventCoverFn = createServerFn({ method: 'POST' })
  .validator(z.object({ dataUrl: z.string().max(7_500_000) }).parse)
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
    if (bytes.length > MAX_COVER_BYTES) {
      throw new DashboardError('Obrázok je príliš veľký (max 5 MB).')
    }
    const mime = detectCoverMime(bytes)
    if (!mime) throw new DashboardError('Podporované sú len JPG, PNG a WebP.')

    const db = serviceClient()
    const path = `${actor.organizerId}/${Date.now()}.${coverExt(mime)}`
    const { error: upErr } = await db.storage
      .from(EVENT_COVERS_BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: true })
    if (upErr) throw new DashboardError('Nahrávanie zlyhalo.')

    const {
      data: { publicUrl },
    } = db.storage.from(EVENT_COVERS_BUCKET).getPublicUrl(path)
    return { ok: true as const, url: publicUrl }
  })

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

// ---------------------------------------------------------------------------
// Webhook endpoints.
// ---------------------------------------------------------------------------

export interface WebhookSummary {
  id: string
  url: string
  events: string[]
  active: boolean
  createdAt: string
}

export const WEBHOOK_EVENTS = WEBHOOK_EVENT_TYPES

export const listWebhooksFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WebhookSummary[]> => {
    const actor = await requireOrganizer()
    const { data } = await serviceClient()
      .from('webhook_endpoints')
      .select('id, url, events, active, created_at')
      .eq('organizer_id', actor.organizerId)
      .order('created_at', { ascending: false })
      .returns<
        {
          id: string
          url: string
          events: string[] | null
          active: boolean
          created_at: string
        }[]
      >()
    return (data ?? []).map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events ?? [],
      active: w.active,
      createdAt: w.created_at,
    }))
  },
)

/** Create an endpoint. Returns the signing secret ONCE. */
export const createWebhookFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      url: z.string().trim().url().max(500),
      events: z
        .array(z.enum([...WEBHOOK_EVENT_TYPES] as [string, ...string[]]))
        .min(1),
    }).parse,
  )
  .handler(async ({ data }) => {
    const actor = await requireOrganizer()
    assertCanEdit(actor)
    const secret = generateWebhookSecret()
    const { error } = await serviceClient().from('webhook_endpoints').insert({
      organizer_id: actor.organizerId,
      url: data.url,
      secret,
      events: data.events,
      active: true,
    })
    if (error) throw new DashboardError('Endpoint sa nepodarilo vytvoriť.')
    return { secret }
  })

export const deleteWebhookFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }).parse)
  .handler(async ({ data }) => {
    const actor = await requireOrganizer()
    assertCanEdit(actor)
    await serviceClient()
      .from('webhook_endpoints')
      .delete()
      .eq('id', data.id)
      .eq('organizer_id', actor.organizerId)
    return { ok: true as const }
  })
