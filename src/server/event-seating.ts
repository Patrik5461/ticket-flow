/**
 * Event ↔ seat map bridge (Phase 21 Block 3). Assigns a reusable seat map to an
 * event: maps each sector to a price category (ticket_type), generates the
 * per-event event_seats (available/blocked), and marks the involved ticket types
 * seated with capacity = seat count (the invariant the reservation functions
 * rely on). Guarded by requireEventManager. Server-only.
 *
 * A map may also carry standing areas (parket, bar). Those have no seats, so
 * their ticket type stays *unseated* with capacity = the area's capacity, and it
 * sells by quantity through the ordinary reserve_ticket_capacity path. Their
 * price mapping shares the event_sector_pricing table under a '#<objectId>' key,
 * a namespace sector names are forbidden from using.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requireEventManager, EventAuthzError } from './event-authz'
import {
  areaPricingKey,
  capacityAreas,
  isAreaPricingKey,
  migrateLayout,
} from '../lib/seating'
import { isLibraryVenue } from '../lib/venue-library'
import type { CapacityArea } from '../lib/seating'

async function run<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof EventAuthzError) return { error: e.message }
    throw e
  }
}

export interface EventSeatingView {
  seatMapId: string | null
  mapName: string | null
  sectors: { sector: string; seatCount: number; ticketTypeId: string | null }[]
  /** Standing areas of the map that sell by capacity. */
  areas: {
    id: string
    label: string
    capacity: number
    ticketTypeId: string | null
  }[]
  statusCounts: {
    available: number
    held: number
    sold: number
    blocked: number
  }
  /** True once any seat is held/sold or any standing ticket is sold — reassignment blocked. */
  locked: boolean
}

/**
 * Standing tickets already sold for this event's areas.
 *
 * Areas generate no event_seats, so the seat-based reassignment guard cannot
 * see them: on a standing-only map it counts zero however much has been sold.
 * Without this, reassigning could drop a category's capacity below its
 * sold_count and leave the event oversold.
 */
async function soldStandingCount(
  db: ReturnType<typeof serviceClient>,
  eventId: string,
): Promise<number> {
  const { data: pricing } = await db
    .from('event_sector_pricing')
    .select('sector, ticket_type_id')
    .eq('event_id', eventId)
    .returns<{ sector: string; ticket_type_id: string }[]>()
  const areaTypeIds = [
    ...new Set(
      (pricing ?? [])
        .filter((p) => isAreaPricingKey(p.sector))
        .map((p) => p.ticket_type_id),
    ),
  ]
  if (areaTypeIds.length === 0) return 0
  const { data: tts } = await db
    .from('ticket_types')
    .select('sold_count')
    .in('id', areaTypeIds)
    .returns<{ sold_count: number }[]>()
  return (tts ?? []).reduce((n, t) => n + t.sold_count, 0)
}

/** The standing areas of a seat map, read straight from its layout jsonb. */
async function loadAreas(
  db: ReturnType<typeof serviceClient>,
  seatMapId: string,
): Promise<CapacityArea[]> {
  const { data } = await db
    .from('seat_maps')
    .select('layout')
    .eq('id', seatMapId)
    .maybeSingle<{ layout: unknown }>()
  return capacityAreas(migrateLayout(data?.layout))
}

export const getEventSeatingFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<EventSeatingView | { error: string }> => {
    return run(async () => {
      await requireEventManager(data.eventId)
      const db = serviceClient()
      const { data: esm } = await db
        .from('event_seat_maps')
        .select('seat_map_id, seat_maps(name)')
        .eq('event_id', data.eventId)
        .maybeSingle<{
          seat_map_id: string
          seat_maps: { name: string } | null
        }>()
      if (!esm) {
        return {
          seatMapId: null,
          mapName: null,
          sectors: [],
          areas: [],
          statusCounts: { available: 0, held: 0, sold: 0, blocked: 0 },
          locked: false,
        }
      }
      const { data: seats } = await db
        .from('seats')
        .select('sector')
        .eq('seat_map_id', esm.seat_map_id)
        .returns<{ sector: string }[]>()
      const bySector = new Map<string, number>()
      for (const s of seats ?? [])
        bySector.set(s.sector, (bySector.get(s.sector) ?? 0) + 1)

      const { data: pricing } = await db
        .from('event_sector_pricing')
        .select('sector, ticket_type_id')
        .eq('event_id', data.eventId)
        .returns<{ sector: string; ticket_type_id: string }[]>()
      const priceOf = new Map(
        (pricing ?? []).map((p) => [p.sector, p.ticket_type_id]),
      )

      const counts = { available: 0, held: 0, sold: 0, blocked: 0 }
      for (const st of ['available', 'held', 'sold', 'blocked'] as const) {
        const { count } = await db
          .from('event_seats')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', data.eventId)
          .eq('status', st)
        counts[st] = count ?? 0
      }
      const areas = await loadAreas(db, esm.seat_map_id)
      const standingSold = await soldStandingCount(db, data.eventId)

      return {
        seatMapId: esm.seat_map_id,
        mapName: esm.seat_maps?.name ?? null,
        sectors: [...bySector.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([sector, seatCount]) => ({
            sector,
            seatCount,
            ticketTypeId: priceOf.get(sector) ?? null,
          })),
        areas: areas.map((a) => ({
          id: a.id,
          label: a.label,
          capacity: a.capacity,
          ticketTypeId: priceOf.get(areaPricingKey(a.id)) ?? null,
        })),
        statusCounts: counts,
        locked: counts.held + counts.sold > 0 || standingSold > 0,
      }
    })
  })

export const assignSeatMapToEventFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        seatMapId: z.string().uuid(),
        sectorPricing: z.array(
          z.object({
            sector: z.string().min(1).max(60),
            ticketTypeId: z.string().uuid(),
          }),
        ),
        areaPricing: z
          .array(
            z.object({
              areaId: z.string().min(1).max(59),
              ticketTypeId: z.string().uuid(),
            }),
          )
          .default([]),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; seatCount: number; standingCapacity: number }
      | { error: string }
    > => {
      return run(async () => {
        await requireEventManager(data.eventId)
        const db = serviceClient()

        const { data: ev } = await db
          .from('events')
          .select('organizer_id')
          .eq('id', data.eventId)
          .maybeSingle<{ organizer_id: string }>()
        if (!ev) throw new EventAuthzError('Podujatie sa nenašlo.')

        const { data: map } = await db
          .from('seat_maps')
          .select('id, venues(organizer_id, is_public)')
          .eq('id', data.seatMapId)
          .maybeSingle<{
            id: string
            venues: { organizer_id: string | null; is_public: boolean } | null
          }>()
        // Own maps, plus the shared library — a library hall has no owner to
        // compare against, so it is usable by every organizer.
        const owner = map?.venues
        const usable =
          owner &&
          (owner.organizer_id === ev.organizer_id ||
            isLibraryVenue({
              organizerId: owner.organizer_id,
              isPublic: owner.is_public,
            }))
        if (!map || !usable) {
          throw new EventAuthzError('Mapa nepatrí tomuto organizátorovi.')
        }

        // Block reassignment once seats are held/sold.
        const { count: live } = await db
          .from('event_seats')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', data.eventId)
          .in('status', ['held', 'sold'])
        if ((live ?? 0) > 0) {
          throw new EventAuthzError(
            'Podujatie už má rezervované/predané sedadlá — mapu nemožno zmeniť.',
          )
        }
        if ((await soldStandingCount(db, data.eventId)) > 0) {
          throw new EventAuthzError(
            'Podujatie už má predané vstupenky na státie — mapu nemožno zmeniť.',
          )
        }

        const { data: seats } = await db
          .from('seats')
          .select('id, sector, seat_type')
          .eq('seat_map_id', data.seatMapId)
          .returns<{ id: string; sector: string; seat_type: string }[]>()
        const allSeats = seats ?? []
        const sectors = [...new Set(allSeats.map((s) => s.sector))]

        const areas = await loadAreas(db, data.seatMapId)
        if (allSeats.length === 0 && areas.length === 0) {
          throw new EventAuthzError(
            'Mapa nemá sedadlá ani plochy s kapacitou — nie je čo predávať.',
          )
        }

        const priceOf = new Map(
          data.sectorPricing.map((p) => [p.sector, p.ticketTypeId]),
        )
        for (const sec of sectors) {
          if (!priceOf.has(sec))
            throw new EventAuthzError(
              `Sektor „${sec}" nemá priradenú cenovú kategóriu.`,
            )
        }
        const areaTypeOf = new Map(
          data.areaPricing.map((p) => [p.areaId, p.ticketTypeId]),
        )
        for (const a of areas) {
          if (!areaTypeOf.has(a.id))
            throw new EventAuthzError(
              `Plocha „${a.label}" nemá priradenú cenovú kategóriu.`,
            )
        }

        // A category is either seated or sold by quantity — never both, or the
        // capacity written below would contradict itself.
        const seatedTypes = new Set(
          sectors.map((s) => priceOf.get(s)!).filter(Boolean),
        )
        for (const a of areas) {
          const tt = areaTypeOf.get(a.id)!
          if (seatedTypes.has(tt)) {
            throw new EventAuthzError(
              `Cenová kategória plochy „${a.label}" sa už používa pre sektor — vytvorte pre státie samostatnú kategóriu.`,
            )
          }
        }

        // All referenced ticket types must belong to this event.
        const ttIds = [
          ...new Set([
            ...data.sectorPricing.map((p) => p.ticketTypeId),
            ...areas.map((a) => areaTypeOf.get(a.id)!),
          ]),
        ]
        const { data: tts } = await db
          .from('ticket_types')
          .select('id')
          .eq('event_id', data.eventId)
          .in('id', ttIds)
          .returns<{ id: string }[]>()
        if ((tts ?? []).length !== ttIds.length) {
          throw new EventAuthzError(
            'Niektorá cenová kategória nepatrí tomuto podujatiu.',
          )
        }

        // Replace assignment + pricing + generated seats (safe: nothing held/sold).
        await db.from('event_seats').delete().eq('event_id', data.eventId)
        await db
          .from('event_sector_pricing')
          .delete()
          .eq('event_id', data.eventId)
        await db.from('event_seat_maps').delete().eq('event_id', data.eventId)

        await db
          .from('event_seat_maps')
          .insert({ event_id: data.eventId, seat_map_id: data.seatMapId })
        const pricingRows = [
          ...data.sectorPricing.map((p) => ({
            event_id: data.eventId,
            sector: p.sector,
            ticket_type_id: p.ticketTypeId,
          })),
          ...areas.map((a) => ({
            event_id: data.eventId,
            sector: areaPricingKey(a.id),
            ticket_type_id: areaTypeOf.get(a.id)!,
          })),
        ]
        if (pricingRows.length > 0)
          await db.from('event_sector_pricing').insert(pricingRows)

        const seatRows = allSeats.map((s) => ({
          event_id: data.eventId,
          seat_id: s.id,
          ticket_type_id: priceOf.get(s.sector),
          status: s.seat_type === 'blocked' ? 'blocked' : 'available',
        }))
        for (let i = 0; i < seatRows.length; i += 1000) {
          const { error } = await db
            .from('event_seats')
            .insert(seatRows.slice(i, i + 1000))
          if (error)
            throw new EventAuthzError(
              'Sedadlá podujatia sa nepodarilo vytvoriť.',
            )
        }

        // Mark involved ticket types seated with capacity = seat count.
        const countByType = new Map<string, number>()
        for (const s of allSeats) {
          const tt = priceOf.get(s.sector)!
          countByType.set(tt, (countByType.get(tt) ?? 0) + 1)
        }
        for (const [ttId, cap] of countByType) {
          await db
            .from('ticket_types')
            .update({ seated: true, capacity: cap })
            .eq('id', ttId)
        }

        // Standing areas stay unseated: quantity tickets capped at the area's
        // capacity, summed when several areas share one category.
        const areaCapByType = new Map<string, number>()
        for (const a of areas) {
          const tt = areaTypeOf.get(a.id)!
          areaCapByType.set(tt, (areaCapByType.get(tt) ?? 0) + a.capacity)
        }
        for (const [ttId, cap] of areaCapByType) {
          await db
            .from('ticket_types')
            .update({ seated: false, capacity: cap })
            .eq('id', ttId)
        }

        return {
          ok: true as const,
          seatCount: allSeats.length,
          standingCapacity: [...areaCapByType.values()].reduce(
            (a, b) => a + b,
            0,
          ),
        }
      })
    },
  )
