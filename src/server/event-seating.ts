/**
 * Event ↔ seat map bridge (Phase 21 Block 3). Assigns a reusable seat map to an
 * event: maps each sector to a price category (ticket_type), generates the
 * per-event event_seats (available/blocked), and marks the involved ticket types
 * seated with capacity = seat count (the invariant the reservation functions
 * rely on). Guarded by requireEventManager. Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requireEventManager, EventAuthzError } from './event-authz'

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
  statusCounts: {
    available: number
    held: number
    sold: number
    blocked: number
  }
  locked: boolean // true once any seat is held/sold — reassignment blocked
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
        statusCounts: counts,
        locked: counts.held + counts.sold > 0,
      }
    })
  })

export const assignSeatMapToEventFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        seatMapId: z.string().uuid(),
        sectorPricing: z
          .array(
            z.object({
              sector: z.string().min(1).max(60),
              ticketTypeId: z.string().uuid(),
            }),
          )
          .min(1),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; seatCount: number } | { error: string }> => {
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
          .select('id, venues(organizer_id)')
          .eq('id', data.seatMapId)
          .maybeSingle<{
            id: string
            venues: { organizer_id: string } | null
          }>()
        if (!map || map.venues?.organizer_id !== ev.organizer_id) {
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

        const { data: seats } = await db
          .from('seats')
          .select('id, sector, seat_type')
          .eq('seat_map_id', data.seatMapId)
          .returns<{ id: string; sector: string; seat_type: string }[]>()
        const allSeats = seats ?? []
        const sectors = [...new Set(allSeats.map((s) => s.sector))]

        const priceOf = new Map(
          data.sectorPricing.map((p) => [p.sector, p.ticketTypeId]),
        )
        for (const sec of sectors) {
          if (!priceOf.has(sec))
            throw new EventAuthzError(
              `Sektor „${sec}" nemá priradenú cenovú kategóriu.`,
            )
        }
        // All referenced ticket types must belong to this event.
        const ttIds = [
          ...new Set(data.sectorPricing.map((p) => p.ticketTypeId)),
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
        await db
          .from('event_sector_pricing')
          .insert(
            data.sectorPricing.map((p) => ({
              event_id: data.eventId,
              sector: p.sector,
              ticket_type_id: p.ticketTypeId,
            })),
          )

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

        return { ok: true as const, seatCount: allSeats.length }
      })
    },
  )
