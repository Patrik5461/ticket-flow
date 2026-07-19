/**
 * Venues + seat maps CRUD (Phase 21 Block 3). Reusable across events, per
 * organizer. Auth mirrors the dashboard: organizer member, owner/admin may edit
 * (check-in role and read-only impersonation may not). Server-only; the editor
 * UI calls these through the RPC surface.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { getCurrentUser } from '../lib/supabase/auth'
import { getImpersonation } from './impersonation-session'
import type { SeatType, SeatMapLayout } from '../lib/seating'

export class VenueError extends Error {}

interface Actor {
  userId: string
  organizerId: string
  role: 'owner' | 'admin' | 'checkin'
  impersonating: boolean
}

async function requireOrganizer(): Promise<Actor> {
  const user = await getCurrentUser()
  if (!user) throw new VenueError('Neprihlásený.')
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
  if (!data) throw new VenueError('Nie ste členom žiadneho organizátora.')
  return {
    userId: user.id,
    organizerId: data.organizer_id,
    role: data.role,
    impersonating: false,
  }
}

function assertCanEdit(actor: Actor): void {
  if (actor.impersonating)
    throw new VenueError('Režim čítania — zmeny nie sú povolené.')
  if (actor.role === 'checkin')
    throw new VenueError('Na túto akciu nemáte oprávnenie.')
}

async function run<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof VenueError) return { error: e.message }
    console.error('[venues] unexpected error:', e)
    throw e
  }
}

async function ownVenue(actor: Actor, venueId: string): Promise<void> {
  const { data } = await serviceClient()
    .from('venues')
    .select('id')
    .eq('id', venueId)
    .eq('organizer_id', actor.organizerId)
    .maybeSingle<{ id: string }>()
  if (!data) throw new VenueError('Miesto konania sa nenašlo.')
}

// ---------------------------------------------------------------------------
// Venues
// ---------------------------------------------------------------------------
export interface VenueRow {
  id: string
  name: string
  address: string | null
  createdAt: string
}

export const listVenuesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<VenueRow[] | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      const { data } = await serviceClient()
        .from('venues')
        .select('id, name, address, created_at')
        .eq('organizer_id', actor.organizerId)
        .order('name', { ascending: true })
        .returns<
          {
            id: string
            name: string
            address: string | null
            created_at: string
          }[]
        >()
      return (data ?? []).map((v) => ({
        id: v.id,
        name: v.name,
        address: v.address,
        createdAt: v.created_at,
      }))
    })
  },
)

export const createVenueFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(200),
        address: z.string().trim().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ id: string } | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      const { data: row, error } = await serviceClient()
        .from('venues')
        .insert({
          organizer_id: actor.organizerId,
          name: data.name,
          address: data.address || null,
        })
        .select('id')
        .single<{ id: string }>()
      if (error) throw new VenueError('Miesto sa nepodarilo vytvoriť.')
      return { id: row.id }
    })
  })

export const updateVenueFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(200),
        address: z.string().trim().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      await ownVenue(actor, data.id)
      await serviceClient()
        .from('venues')
        .update({
          name: data.name,
          address: data.address || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', data.id)
      return { ok: true as const }
    })
  })

export const deleteVenueFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      await ownVenue(actor, data.id)
      await serviceClient().from('venues').delete().eq('id', data.id)
      return { ok: true as const }
    })
  })

// ---------------------------------------------------------------------------
// Seat maps
// ---------------------------------------------------------------------------
export interface SeatMapSummary {
  id: string
  name: string
  seatCount: number
  inUse: boolean
}

const seatInput = z.object({
  level: z.string().max(60).default('main'),
  levelOrder: z.number().int().default(0),
  sector: z.string().min(1).max(60),
  rowLabel: z.string().min(1).max(20),
  seatNumber: z.string().min(1).max(20),
  x: z.number(),
  y: z.number(),
  seatType: z.enum(['standard', 'wheelchair', 'blocked']).default('standard'),
  externalRef: z.string().max(200).optional().nullable(),
})

export const listSeatMapsFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ venueId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<SeatMapSummary[] | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      await ownVenue(actor, data.venueId)
      const db = serviceClient()
      const { data: maps } = await db
        .from('seat_maps')
        .select('id, name')
        .eq('venue_id', data.venueId)
        .order('name', { ascending: true })
        .returns<{ id: string; name: string }[]>()
      const out: SeatMapSummary[] = []
      for (const m of maps ?? []) {
        const { count: seatCount } = await db
          .from('seats')
          .select('*', { count: 'exact', head: true })
          .eq('seat_map_id', m.id)
        const { count: uses } = await db
          .from('event_seat_maps')
          .select('*', { count: 'exact', head: true })
          .eq('seat_map_id', m.id)
        out.push({
          id: m.id,
          name: m.name,
          seatCount: seatCount ?? 0,
          inUse: (uses ?? 0) > 0,
        })
      }
      return out
    })
  })

export interface SeatMapDetail {
  id: string
  venueId: string
  name: string
  layout: SeatMapLayout
  inUse: boolean
  seats: {
    id: string
    level: string
    levelOrder: number
    sector: string
    rowLabel: string
    seatNumber: string
    x: number
    y: number
    seatType: SeatType
  }[]
}

export const getSeatMapFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z.object({ seatMapId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }): Promise<SeatMapDetail | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      const db = serviceClient()
      const { data: map } = await db
        .from('seat_maps')
        .select('id, venue_id, name, layout, venues(organizer_id)')
        .eq('id', data.seatMapId)
        .maybeSingle<{
          id: string
          venue_id: string
          name: string
          layout: SeatMapLayout | null
          venues: { organizer_id: string } | null
        }>()
      if (!map || map.venues?.organizer_id !== actor.organizerId) {
        throw new VenueError('Mapa sa nenašla.')
      }
      const { data: seats } = await db
        .from('seats')
        .select(
          'id, level, level_order, sector, row_label, seat_number, x, y, seat_type',
        )
        .eq('seat_map_id', data.seatMapId)
        .order('level_order', { ascending: true })
        .returns<
          {
            id: string
            level: string
            level_order: number
            sector: string
            row_label: string
            seat_number: string
            x: number
            y: number
            seat_type: SeatType
          }[]
        >()
      const { count: uses } = await db
        .from('event_seat_maps')
        .select('*', { count: 'exact', head: true })
        .eq('seat_map_id', data.seatMapId)
      return {
        id: map.id,
        venueId: map.venue_id,
        name: map.name,
        layout: map.layout ?? { levels: [] },
        inUse: (uses ?? 0) > 0,
        seats: (seats ?? []).map((s) => ({
          id: s.id,
          level: s.level,
          levelOrder: s.level_order,
          sector: s.sector,
          rowLabel: s.row_label,
          seatNumber: s.seat_number,
          x: s.x,
          y: s.y,
          seatType: s.seat_type,
        })),
      }
    })
  })

export const saveSeatMapFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        seatMapId: z.string().uuid().optional().nullable(),
        venueId: z.string().uuid(),
        name: z.string().trim().min(1).max(200),
        layout: z.unknown().default({}),
        seats: z.array(seatInput).max(50_000),
        externalRef: z.string().max(200).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ id: string } | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      await ownVenue(actor, data.venueId)
      const db = serviceClient()

      let mapId = data.seatMapId ?? null
      if (mapId) {
        // Editing an existing map: block structural changes while it is assigned
        // to an event (its event_seats would cascade away). Duplicate to edit.
        const { count: uses } = await db
          .from('event_seat_maps')
          .select('*', { count: 'exact', head: true })
          .eq('seat_map_id', mapId)
        if ((uses ?? 0) > 0) {
          throw new VenueError(
            'Mapa sa používa v podujatí — vytvorte kópiu na úpravu.',
          )
        }
        await db
          .from('seat_maps')
          .update({
            name: data.name,
            layout: data.layout,
            updated_at: new Date().toISOString(),
          })
          .eq('id', mapId)
        await db.from('seats').delete().eq('seat_map_id', mapId)
      } else {
        const { data: row, error } = await db
          .from('seat_maps')
          .insert({
            venue_id: data.venueId,
            name: data.name,
            layout: data.layout,
            external_ref: data.externalRef || null,
          })
          .select('id')
          .single<{ id: string }>()
        if (error) throw new VenueError('Mapu sa nepodarilo uložiť.')
        mapId = row.id
      }

      if (data.seats.length > 0) {
        const rows = data.seats.map((s) => ({
          seat_map_id: mapId,
          level: s.level,
          level_order: s.levelOrder,
          sector: s.sector,
          row_label: s.rowLabel,
          seat_number: s.seatNumber,
          x: s.x,
          y: s.y,
          seat_type: s.seatType,
          external_ref: s.externalRef || null,
        }))
        // Chunked insert to stay within statement limits on large halls.
        for (let i = 0; i < rows.length; i += 1000) {
          const { error } = await db
            .from('seats')
            .insert(rows.slice(i, i + 1000))
          if (error) throw new VenueError('Sedadlá sa nepodarilo uložiť.')
        }
      }
      return { id: mapId }
    })
  })

export const deleteSeatMapFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z.object({ seatMapId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return run(async () => {
      const actor = await requireOrganizer()
      assertCanEdit(actor)
      const db = serviceClient()
      const { data: map } = await db
        .from('seat_maps')
        .select('id, venues(organizer_id)')
        .eq('id', data.seatMapId)
        .maybeSingle<{ id: string; venues: { organizer_id: string } | null }>()
      if (!map || map.venues?.organizer_id !== actor.organizerId) {
        throw new VenueError('Mapa sa nenašla.')
      }
      const { count: uses } = await db
        .from('event_seat_maps')
        .select('*', { count: 'exact', head: true })
        .eq('seat_map_id', data.seatMapId)
      if ((uses ?? 0) > 0) throw new VenueError('Mapa sa používa v podujatí.')
      await db.from('seat_maps').delete().eq('id', data.seatMapId)
      return { ok: true as const }
    })
  })
