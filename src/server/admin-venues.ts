/**
 * Platform-admin maintenance of the shared venue library.
 *
 * The library holds ~460 halls imported from MaxiTicket (scripts/import-halls.ts).
 * They belong to no organizer, so nobody could fix one when it came out wrong:
 * src/server/venues.ts refuses every write to a hall the caller does not own,
 * which is correct for organizers and leaves the library with no maintainer.
 * This module is that maintainer, and it is deliberately narrow:
 *
 *  - platform admins only (requirePlatformAdmin), 404 to everyone else;
 *  - LIBRARY halls only. An admin editing an organizer's private venue is a
 *    different power with different consequences, and it is not granted here —
 *    every lookup goes through libraryVenue(), which refuses anything owned;
 *  - a map already bound to an event is refused, exactly as on the organizer
 *    side. Rewriting its seats cascades event_seats away and takes sold tickets
 *    with them, and being an admin does not make that recoverable;
 *  - every mutation writes an audit_log row. A library hall is shared by every
 *    organizer on the platform, so a change to one has to be attributable.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import {
  requirePlatformAdmin,
  runAdmin,
  writeAuditLog,
  AdminError,
} from './admin'
import { migrateLayout } from '../lib/seating'
import { AUDIT_ACTION_LABEL, summarizeAuditChange } from '../lib/audit-summary'
import { filterVenues, isLibraryVenue } from '../lib/venue-library'
import { saveSeatMapInput } from './venues'
import { readAllSeats } from './db-paging'
import { writeSeatMap, SeatMapWriteError } from './seat-map-write'
import type { SeatMapDetail } from './venues'

/**
 * Halls shown at once. Counting seats costs one query per map, so the page is
 * kept short and `total` tells the caller how many matched — a truncated list
 * that looked complete would be worse than a short one that says so.
 */
const LIST_LIMIT = 40

export interface AdminVenueRow {
  id: string
  name: string
  address: string | null
  externalRef: string | null
  mapCount: number
  seatCount: number
  /** Maps of this hall that an event already uses — those cannot be rewritten. */
  inUseMaps: number
  /** Set once an admin corrected the hall; the importer then skips it. */
  importLockedAt: string | null
}

export interface AdminVenueList {
  rows: AdminVenueRow[]
  /** How many halls matched, before the page limit. */
  total: number
}

/**
 * Resolve a library hall by id, or throw. This is the access rule: a venue with
 * an owner is not part of the library and is none of the admin's business here.
 */
async function libraryVenue(venueId: string): Promise<{
  id: string
  name: string
  address: string | null
  externalRef: string | null
  importLockedAt: string | null
}> {
  const { data } = await serviceClient()
    .from('venues')
    .select(
      'id, name, address, external_ref, import_locked_at, organizer_id, is_public',
    )
    .eq('id', venueId)
    .maybeSingle<{
      id: string
      name: string
      address: string | null
      external_ref: string | null
      import_locked_at: string | null
      organizer_id: string | null
      is_public: boolean
    }>()
  if (
    !data ||
    !isLibraryVenue({
      organizerId: data.organizer_id,
      isPublic: data.is_public,
    })
  ) {
    throw new AdminError('Hala sa nenašla v knižnici.')
  }
  return {
    id: data.id,
    name: data.name,
    address: data.address,
    externalRef: data.external_ref,
    importLockedAt: data.import_locked_at,
  }
}

/**
 * Mark a hall (and optionally one of its maps) as hand-corrected, so the next
 * run of scripts/import-halls.ts leaves it alone. Called on every admin write —
 * a fix that the importer can revert is not a fix.
 *
 * Idempotent: the timestamp is the FIRST correction, not the latest one. "Since
 * when has this diverged from the export" is the useful question; "when was it
 * last touched" is already in audit_log and in updated_at.
 */
async function lockFromImport(
  venueId: string,
  seatMapId?: string | null,
): Promise<void> {
  const db = serviceClient()
  const now = new Date().toISOString()
  await db
    .from('venues')
    .update({ import_locked_at: now })
    .eq('id', venueId)
    .is('import_locked_at', null)
  if (seatMapId) {
    await db
      .from('seat_maps')
      .update({ import_locked_at: now })
      .eq('id', seatMapId)
      .is('import_locked_at', null)
  }
}

/** The map's hall, checked the same way — and the map's own in-use count. */
async function libraryMap(seatMapId: string): Promise<{
  id: string
  venueId: string
  name: string
  uses: number
  updatedAt: string
}> {
  const db = serviceClient()
  const { data: map } = await db
    .from('seat_maps')
    .select('id, venue_id, name, updated_at')
    .eq('id', seatMapId)
    .maybeSingle<{
      id: string
      venue_id: string
      name: string
      updated_at: string
    }>()
  if (!map) throw new AdminError('Mapa sa nenašla.')
  await libraryVenue(map.venue_id)
  const { count } = await db
    .from('event_seat_maps')
    .select('*', { count: 'exact', head: true })
    .eq('seat_map_id', seatMapId)
  return {
    id: map.id,
    venueId: map.venue_id,
    name: map.name,
    uses: count ?? 0,
    updatedAt: map.updated_at,
  }
}

/**
 * Every seat of a map, or an error the admin can read. Truncation is the thing
 * being guarded against: the editor writes back exactly what it loaded, so a
 * hall read short would be a hall saved short (see db-paging.ts).
 */
async function loadSeats(seatMapId: string) {
  try {
    return await readAllSeats(serviceClient(), seatMapId)
  } catch (e) {
    throw new AdminError(
      e instanceof Error ? e.message : 'Sedadlá sa nepodarilo načítať.',
    )
  }
}

const IN_USE =
  'Mapa sa už používa v podujatí — prepis by zmazal predané sedadlá. Uprav ju až keď podujatie skončí, alebo si organizátor spraví kópiu.'

/**
 * Library halls matching `q`, by name or address.
 *
 * The whole library is read and filtered here rather than in SQL. `ilike` is
 * case-insensitive but not diacritics-insensitive, so a SQL filter would answer
 * "Žilina" and not "zilina" — and nobody types the accent when searching. The
 * organizer's picker already solved this in venueMatches(); reusing it keeps
 * one definition of "matches" instead of two that drift. 460 rows of name and
 * address is a few tens of kilobytes and never leaves the server.
 */
export const adminListVenuesFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z
      .object({ q: z.string().trim().max(120).optional() })
      .default({})
      .parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<AdminVenueList | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const db = serviceClient()
      const { data: all } = await db
        .from('venues')
        .select('id, name, address, external_ref, import_locked_at')
        .is('organizer_id', null)
        .eq('is_public', true)
        .order('name', { ascending: true })
        .limit(5000)
        .returns<
          {
            id: string
            name: string
            address: string | null
            external_ref: string | null
            import_locked_at: string | null
          }[]
        >()
      const matched = data.q
        ? filterVenues(
            (all ?? []).map((v) => ({ ...v, readOnly: true })),
            data.q,
          )
        : (all ?? [])
      const venues = matched.slice(0, LIST_LIMIT)
      if (venues.length === 0) return { rows: [], total: matched.length }

      // One round trip for the maps of every listed hall, then count in memory:
      // a per-hall query would be 60 round trips for one screen.
      const ids = venues.map((v) => v.id)
      const { data: maps } = await db
        .from('seat_maps')
        .select('id, venue_id')
        .in('venue_id', ids)
        .returns<{ id: string; venue_id: string }[]>()
      const mapIds = (maps ?? []).map((m) => m.id)

      const seatCounts = new Map<string, number>()
      const inUse = new Set<string>()
      if (mapIds.length > 0) {
        // seats can run to hundreds of thousands, so count per map rather than
        // reading rows. head+exact keeps each of these to a count, not a page.
        await Promise.all(
          mapIds.map(async (id) => {
            const { count } = await db
              .from('seats')
              .select('*', { count: 'exact', head: true })
              .eq('seat_map_id', id)
            seatCounts.set(id, count ?? 0)
          }),
        )
        const { data: bound } = await db
          .from('event_seat_maps')
          .select('seat_map_id')
          .in('seat_map_id', mapIds)
          .returns<{ seat_map_id: string }[]>()
        for (const b of bound ?? []) inUse.add(b.seat_map_id)
      }

      return {
        rows: venues.map((v) => {
          const own = (maps ?? []).filter((m) => m.venue_id === v.id)
          return {
            id: v.id,
            name: v.name,
            address: v.address,
            externalRef: v.external_ref,
            mapCount: own.length,
            seatCount: own.reduce((n, m) => n + (seatCounts.get(m.id) ?? 0), 0),
            inUseMaps: own.filter((m) => inUse.has(m.id)).length,
            importLockedAt: v.import_locked_at,
          }
        }),
        total: matched.length,
      }
    })
  })

export interface AdminVenueDetail {
  id: string
  name: string
  address: string | null
  externalRef: string | null
  /** Set once an admin corrected this hall; the importer then skips it. */
  importLockedAt: string | null
  maps: {
    id: string
    name: string
    seatCount: number
    objectCount: number
    inUse: boolean
    importLockedAt: string | null
  }[]
}

export const adminGetVenueFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<AdminVenueDetail | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const venue = await libraryVenue(data.id)
      const db = serviceClient()
      const { data: maps } = await db
        .from('seat_maps')
        .select('id, name, layout, import_locked_at')
        .eq('venue_id', data.id)
        .order('name', { ascending: true })
        .returns<
          {
            id: string
            name: string
            layout: unknown
            import_locked_at: string | null
          }[]
        >()

      const out: AdminVenueDetail['maps'] = []
      for (const m of maps ?? []) {
        const { count: seatCount } = await db
          .from('seats')
          .select('*', { count: 'exact', head: true })
          .eq('seat_map_id', m.id)
        const { count: uses } = await db
          .from('event_seat_maps')
          .select('*', { count: 'exact', head: true })
          .eq('seat_map_id', m.id)
        const layout = migrateLayout(m.layout)
        out.push({
          id: m.id,
          name: m.name,
          seatCount: seatCount ?? 0,
          objectCount: layout.levels.reduce(
            (n, lv) => n + lv.objects.length,
            0,
          ),
          inUse: (uses ?? 0) > 0,
          importLockedAt: m.import_locked_at,
        })
      }
      return {
        id: venue.id,
        name: venue.name,
        address: venue.address,
        externalRef: venue.externalRef,
        importLockedAt: venue.importLockedAt,
        maps: out,
      }
    })
  })

/** The same detail shape the organizer editor reads, so one editor fits both. */
export const adminGetSeatMapFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z.object({ seatMapId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }): Promise<SeatMapDetail | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const map = await libraryMap(data.seatMapId)
      const db = serviceClient()
      const { data: row } = await db
        .from('seat_maps')
        .select('layout')
        .eq('id', map.id)
        .maybeSingle<{ layout: unknown }>()
      // `.limit(50_000)` used to stand here and read like a safety margin; it is
      // not one. PostgREST caps the response at 1000 rows whatever the limit
      // says, so the biggest halls in the library came back as their first 1000
      // seats — and saving then deleted the other ten thousand.
      const seats = await loadSeats(map.id)
      return {
        id: map.id,
        venueId: map.venueId,
        name: map.name,
        layout: migrateLayout(row?.layout),
        inUse: map.uses > 0,
        // The admin IS the maintainer, so the editor opens unlocked — unless
        // the map is in use, which `inUse` already locks for everyone.
        readOnly: false,
        updatedAt: map.updatedAt,
        seats: seats.map((s) => ({
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

/**
 * Rewrite a library map. Same payload and same limits as the organizer's save;
 * what differs is who may call it and that it lands in the audit log.
 *
 * The map's external_ref is left alone on purpose: it is what makes a re-run of
 * the importer update this map instead of inserting a second copy. An admin fix
 * is therefore not permanent — the next import overwrites it. That is the right
 * default (the export stays the source of truth), and it is why the UI says so.
 */
export const adminSaveSeatMapFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => saveSeatMapInput.parse(d))
  .handler(async ({ data }): Promise<{ id: string } | { error: string }> => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      await libraryVenue(data.venueId)
      const db = serviceClient()

      // What the hall looked like before, for the audit trail. Read ahead of
      // the write because afterwards it is gone — and the seat count is the
      // number that makes a bad save recognisable later.
      let before: { name: string; seats: number } | null = null
      if (data.seatMapId) {
        const map = await libraryMap(data.seatMapId)
        if (map.venueId !== data.venueId) {
          throw new AdminError('Mapa nepatrí k tejto hale.')
        }
        if (map.uses > 0) throw new AdminError(IN_USE)
        const { count } = await db
          .from('seats')
          .select('*', { count: 'exact', head: true })
          .eq('seat_map_id', data.seatMapId)
        before = { name: map.name, seats: count ?? 0 }
      }

      // One transaction, one row lock, the in-use check inside it — the same
      // write the organizer side performs (see seat-map-write.ts). The checks
      // above are the fast path with the better message, not the guarantee.
      let saved
      try {
        saved = await writeSeatMap(db, {
          ...data,
          expectedUpdatedAt: data.updatedAt,
        })
      } catch (e) {
        if (e instanceof SeatMapWriteError) throw new AdminError(e.message)
        throw e
      }
      const mapId = saved.id

      await lockFromImport(data.venueId, mapId)
      await writeAuditLog({
        actorId: admin.userId,
        action: before ? 'admin.venue_map_update' : 'admin.venue_map_create',
        entityType: 'seat_map',
        entityId: mapId,
        oldValue: before,
        newValue: {
          name: data.name,
          seats: saved.seatCount,
          objects: saved.objectCount,
        },
      })
      return { id: mapId }
    })
  })

export const adminDeleteSeatMapFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z.object({ seatMapId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const map = await libraryMap(data.seatMapId)
      if (map.uses > 0) throw new AdminError(IN_USE)
      const db = serviceClient()
      const { error } = await db
        .from('seat_maps')
        .delete()
        .eq('id', data.seatMapId)
      if (error) throw new AdminError('Mapu sa nepodarilo zmazať.')
      // Lock the hall, not the map — the map is gone. Without this the next
      // import would re-create it from the export and undo the deletion.
      await lockFromImport(map.venueId)
      await writeAuditLog({
        actorId: admin.userId,
        action: 'admin.venue_map_delete',
        entityType: 'seat_map',
        entityId: data.seatMapId,
        oldValue: { name: map.name, venueId: map.venueId },
        newValue: null,
      })
      return { ok: true as const }
    })
  })

/**
 * Give a hall back to the importer: the next run overwrites its name, address,
 * layout and seats from the export again, and the hand corrections are gone.
 * The only way out of the lock, and the reason it is a separate, named action
 * rather than a checkbox on the save form.
 */
export const adminUnlockVenueFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const venue = await libraryVenue(data.id)
      const db = serviceClient()
      const { error } = await db
        .from('venues')
        .update({ import_locked_at: null })
        .eq('id', data.id)
      if (error) throw new AdminError('Zámok sa nepodarilo uvoľniť.')
      const { error: mapErr } = await db
        .from('seat_maps')
        .update({ import_locked_at: null })
        .eq('venue_id', data.id)
      if (mapErr) throw new AdminError('Zámok máp sa nepodarilo uvoľniť.')
      await writeAuditLog({
        actorId: admin.userId,
        action: 'admin.venue_import_unlock',
        entityType: 'venue',
        entityId: data.id,
        oldValue: { importLockedAt: venue.importLockedAt },
        newValue: { importLockedAt: null },
      })
      return { ok: true as const }
    })
  })

export interface AdminVenueHistoryEntry {
  id: string
  at: string
  /** What happened, in Slovak — the raw action code stays server-side. */
  label: string
  /** What actually changed, e.g. „sedadlá 390 → 388". Empty when there is none. */
  detail: string
  actorEmail: string
}

/**
 * What has been done to this hall and its maps, newest first.
 *
 * Read straight out of audit_log — the trail every mutation in this module
 * already writes — rather than a second table that could disagree with it.
 * audit_log has RLS on and NO policies at all, so it is service-role only:
 * this history cannot leak to an organizer even if a route were mis-wired.
 */
export const adminVenueHistoryFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(d),
  )
  .handler(
    async ({ data }): Promise<AdminVenueHistoryEntry[] | { error: string }> => {
      return runAdmin(async () => {
        await requirePlatformAdmin()
        await libraryVenue(data.id)
        const db = serviceClient()

        // A map that was deleted still has history, so the ids come from the
        // trail itself as well as from the maps that exist right now.
        const { data: maps } = await db
          .from('seat_maps')
          .select('id')
          .eq('venue_id', data.id)
          .returns<{ id: string }[]>()
        const ids = [data.id, ...(maps ?? []).map((m) => m.id)]
        const { data: rows } = await db
          .from('audit_log')
          .select(
            'id, actor_id, action, entity_type, entity_id, old_value, new_value, created_at',
          )
          .in('entity_id', ids)
          .order('created_at', { ascending: false })
          .limit(data.limit)
          .returns<
            {
              id: string
              actor_id: string | null
              action: string
              entity_type: string
              entity_id: string | null
              old_value: unknown
              new_value: unknown
              created_at: string
            }[]
          >()

        // Resolve each actor once; a hall's history is a handful of admins.
        const emails = new Map<string, string>()
        for (const r of rows ?? []) {
          if (!r.actor_id || emails.has(r.actor_id)) continue
          const { data: user } = await db.auth.admin.getUserById(r.actor_id)
          emails.set(r.actor_id, user.user?.email ?? '—')
        }

        return (rows ?? []).map((r) => ({
          id: r.id,
          at: r.created_at,
          label: AUDIT_ACTION_LABEL[r.action] ?? r.action,
          detail: summarizeAuditChange(r.old_value, r.new_value),
          actorEmail: r.actor_id ? (emails.get(r.actor_id) ?? '—') : 'systém',
        }))
      })
    },
  )

/** Rename a library hall / fix its address. */
export const adminUpdateVenueFn = createServerFn({ method: 'POST' })
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
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const venue = await libraryVenue(data.id)
      const { error } = await serviceClient()
        .from('venues')
        .update({
          name: data.name,
          address: data.address?.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', data.id)
      if (error) throw new AdminError('Halu sa nepodarilo uložiť.')
      await lockFromImport(data.id)
      await writeAuditLog({
        actorId: admin.userId,
        action: 'admin.venue_update',
        entityType: 'venue',
        entityId: data.id,
        oldValue: { name: venue.name, address: venue.address },
        newValue: { name: data.name, address: data.address?.trim() || null },
      })
      return { ok: true as const }
    })
  })
