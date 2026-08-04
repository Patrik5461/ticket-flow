/**
 * The one place a seat map is written.
 *
 * Both entry points — the organizer's own venues and the platform admin's
 * library halls — end up here, because the dangerous part is identical and must
 * not drift: rewriting a map means deleting every seat it has and inserting the
 * new set, and that has to happen atomically or not at all. The app cannot do
 * that over PostgREST (each statement is its own transaction), so the work
 * happens inside save_seat_map() — see
 * supabase/migrations/20260804110000_seat_map_transactional_save.sql.
 *
 * What stays on this side: authorization (who owns the venue, who is an admin),
 * which is why the DB function is service-role only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { migrateLayout } from '../lib/seating'
import type { SeatMapLayout } from '../lib/seating'

/** Objects a single map may hold — a guard against a runaway client payload. */
export const MAX_OBJECTS = 500

export class SeatMapWriteError extends Error {}

/**
 * The DB function raises a stable code; the Slovak text lives here so both
 * callers say the same thing.
 */
const MESSAGE: Record<string, string> = {
  MAP_NOT_FOUND: 'Mapa sa nenašla.',
  MAP_VENUE_MISMATCH: 'Mapa nepatrí k tejto hale.',
  MAP_IN_USE: 'Mapa sa používa v podujatí — vytvorte kópiu na úpravu.',
  MAP_STALE:
    'Mapu medzitým uložil niekto iný. Otvorte ju znova — uloženie by jeho zmeny prepísalo.',
}

export interface SeatMapWriteInput {
  seatMapId?: string | null
  venueId: string
  name: string
  layout: unknown
  seats: {
    level: string
    levelOrder: number
    sector: string
    rowLabel: string
    seatNumber: string
    x: number
    y: number
    seatType: string
    externalRef?: string | null
  }[]
  externalRef?: string | null
  /**
   * `updated_at` as it was when the editor loaded the map. The write is refused
   * if the row has moved on since — otherwise the second of two people editing
   * the same hall silently erases the first one's work.
   */
  expectedUpdatedAt?: string | null
}

interface SaveSeatMapRow {
  out_id: string
  out_updated_at: string
  out_seat_count: number
}

export interface SeatMapWriteResult {
  id: string
  updatedAt: string
  seatCount: number
  layout: SeatMapLayout
  objectCount: number
}

export async function writeSeatMap(
  db: SupabaseClient,
  input: SeatMapWriteInput,
): Promise<SeatMapWriteResult> {
  // Store a canonical v2 layout whatever the client sent: the migration is also
  // the validator, so unknown fields never reach the jsonb column.
  const layout = migrateLayout(input.layout)
  const objectCount = layout.levels.reduce((n, lv) => n + lv.objects.length, 0)
  if (objectCount > MAX_OBJECTS) {
    throw new SeatMapWriteError(
      `Mapa smie mať najviac ${MAX_OBJECTS} objektov.`,
    )
  }

  const { data, error } = await db.rpc('save_seat_map', {
    p_seat_map_id: input.seatMapId ?? null,
    p_venue_id: input.venueId,
    p_name: input.name,
    p_layout: layout,
    p_seats: input.seats.map((s) => ({
      level: s.level,
      level_order: s.levelOrder,
      sector: s.sector,
      row_label: s.rowLabel,
      seat_number: s.seatNumber,
      x: s.x,
      y: s.y,
      seat_type: s.seatType,
      external_ref: s.externalRef || null,
    })),
    p_external_ref: input.externalRef || null,
    p_expected_updated_at: input.expectedUpdatedAt || null,
  })

  if (error) {
    const known = MESSAGE[error.message.trim()]
    if (known) throw new SeatMapWriteError(known)
    console.error('[seat-map-write] save_seat_map failed:', error)
    throw new SeatMapWriteError('Mapu sa nepodarilo uložiť.')
  }
  // The function `returns table (…)`, so PostgREST answers with a one-row array.
  const row = (data as SaveSeatMapRow[] | null)?.[0]
  if (!row) throw new SeatMapWriteError('Mapu sa nepodarilo uložiť.')

  // The rewrite is atomic, so a count that does not match what was sent means
  // the payload itself was wrong — better loud than a quietly thinner map.
  if (row.out_seat_count !== input.seats.length) {
    throw new SeatMapWriteError(
      `Uložilo sa ${row.out_seat_count} z ${input.seats.length} sedadiel — mapa nie je uložená správne.`,
    )
  }

  return {
    id: row.out_id,
    updatedAt: row.out_updated_at,
    seatCount: row.out_seat_count,
    layout,
    objectCount,
  }
}
