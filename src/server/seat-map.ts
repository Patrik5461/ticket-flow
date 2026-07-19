/**
 * Buyer-facing seat availability for the checkout seat picker (Phase 21
 * Block 4). Public, read-only, served via the service client (like
 * getPublicEvent) — no anon RLS policy needed. Held/sold/blocked all read as
 * "unavailable" to the buyer; we never leak who holds a seat.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import type { SeatType, SeatMapLayout } from '../lib/seating'

export type SeatAvailability = 'available' | 'taken' | 'blocked'

export interface BuyerSeat {
  seatId: string
  level: string
  sector: string
  rowLabel: string
  seatNumber: string
  x: number
  y: number
  seatType: SeatType
  availability: SeatAvailability
  ticketTypeId: string
  priceCents: number
}

export interface EventSeatMap {
  seated: boolean
  layout: SeatMapLayout
  levels: { key: string; name: string; order: number }[]
  ticketTypes: { id: string; name: string; priceCents: number }[]
  seats: BuyerSeat[]
}

const EMPTY: EventSeatMap = {
  seated: false,
  layout: { levels: [] },
  levels: [],
  ticketTypes: [],
  seats: [],
}

export const getEventSeatMapFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ slug: z.string().min(1) }).parse(d))
  .handler(async ({ data }): Promise<EventSeatMap> => {
    const db = serviceClient()
    const { data: event } = await db
      .from('events')
      .select('id')
      .eq('slug', data.slug)
      .eq('status', 'published')
      .maybeSingle<{ id: string }>()
    if (!event) return EMPTY

    const { data: esm } = await db
      .from('event_seat_maps')
      .select('seat_map_id, seat_maps(layout)')
      .eq('event_id', event.id)
      .maybeSingle<{
        seat_map_id: string
        seat_maps: { layout: SeatMapLayout | null } | null
      }>()
    if (!esm) return EMPTY

    const { data: rows } = await db
      .from('event_seats')
      .select(
        'seat_id, status, ticket_type_id, seats(level, level_order, sector, row_label, seat_number, x, y, seat_type), ticket_types(name, price_cents)',
      )
      .eq('event_id', event.id)
      .returns<
        {
          seat_id: string
          status: string
          ticket_type_id: string
          seats: {
            level: string
            level_order: number
            sector: string
            row_label: string
            seat_number: string
            x: number
            y: number
            seat_type: SeatType
          } | null
          ticket_types: { name: string; price_cents: number } | null
        }[]
      >()

    const levelOrder = new Map<string, number>()
    const ttMap = new Map<
      string,
      { id: string; name: string; priceCents: number }
    >()
    const seats: BuyerSeat[] = []
    for (const r of rows ?? []) {
      if (!r.seats) continue
      levelOrder.set(r.seats.level, r.seats.level_order)
      if (r.ticket_types) {
        ttMap.set(r.ticket_type_id, {
          id: r.ticket_type_id,
          name: r.ticket_types.name,
          priceCents: r.ticket_types.price_cents,
        })
      }
      const availability: SeatAvailability =
        r.seats.seat_type === 'blocked' || r.status === 'blocked'
          ? 'blocked'
          : r.status === 'available'
            ? 'available'
            : 'taken'
      seats.push({
        seatId: r.seat_id,
        level: r.seats.level,
        sector: r.seats.sector,
        rowLabel: r.seats.row_label,
        seatNumber: r.seats.seat_number,
        x: r.seats.x,
        y: r.seats.y,
        seatType: r.seats.seat_type,
        availability,
        ticketTypeId: r.ticket_type_id,
        priceCents: r.ticket_types?.price_cents ?? 0,
      })
    }

    return {
      seated: seats.length > 0,
      layout: esm.seat_maps?.layout ?? { levels: [] },
      levels: [...levelOrder.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([key, order]) => ({ key, name: key, order })),
      ticketTypes: [...ttMap.values()],
      seats,
    }
  })
