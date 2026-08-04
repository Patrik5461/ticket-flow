/**
 * Reading a whole table's worth of rows out of PostgREST.
 *
 * PostgREST caps every response at `db-max-rows` (1000 on Supabase cloud) and
 * says so only in the Content-Range header — a plain `.select()` just comes back
 * short, and `.limit(50_000)` does not raise the cap, it only looks like it
 * does. Every read of `seats` in this app used to trust that: the editor showed
 * the first 1000 seats of an 11 604-seat hall as if that were the whole map, and
 * saving then deleted the rest. Assigning such a hall to an event created 1000
 * sellable seats out of 11 604, and the buyer's map drew the same 1000.
 *
 * So: never `.select()` a set that can exceed 1000 rows without going through
 * here.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SeatType } from '../lib/seating'

/** Rows requested per round trip. The server may return fewer; see readAllRows. */
export const REST_PAGE = 1000

/** Runaway guard. The biggest imported hall is ~11 600 seats. */
export const MAX_PAGED_ROWS = 100_000

/** The part of a PostgREST query builder this needs: give it a range, await it. */
interface Pageable<T> {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
}

/**
 * Read every row of a query, one page at a time.
 *
 * `build` is called once per page because a PostgREST builder cannot be awaited
 * twice. The query it returns MUST have a deterministic order (a unique column),
 * otherwise two pages can repeat or skip rows.
 *
 * The loop stops on an EMPTY page, never on a short one: the server silently
 * caps a page below what was asked for, so "fewer rows than requested" does not
 * mean "no more rows". The offset walks by rows actually received, so a capped
 * page just makes the next request start where this one really ended.
 */
export async function readAllRows<T>(
  build: () => Pageable<T>,
  label: string,
  max = MAX_PAGED_ROWS,
): Promise<T[]> {
  const out: T[] = []
  for (;;) {
    const { data, error } = await build().range(
      out.length,
      out.length + REST_PAGE - 1,
    )
    if (error) throw new Error(`${label}: ${error.message}`)
    const rows = data ?? []
    if (rows.length === 0) return out
    out.push(...rows)
    if (out.length > max) {
      throw new Error(`${label}: viac než ${max} riadkov, čítanie zastavené`)
    }
  }
}

/** One seat as the editor and the event bridge read it. */
export interface SeatRow {
  id: string
  level: string
  level_order: number
  sector: string
  row_label: string
  seat_number: string
  x: number
  y: number
  seat_type: SeatType
}

export const SEAT_COLUMNS =
  'id, level, level_order, sector, row_label, seat_number, x, y, seat_type'

/**
 * Every seat of a map, ordered by id, checked against the row count.
 *
 * The count is the point: a short read here is not a display glitch but the
 * first half of data loss, because the editor writes back what it read. If the
 * two disagree, the caller gets an error instead of a partial map.
 */
export async function readAllSeats<T = SeatRow>(
  db: SupabaseClient,
  seatMapId: string,
  columns: string = SEAT_COLUMNS,
): Promise<T[]> {
  const { count, error: countErr } = await db
    .from('seats')
    .select('*', { count: 'exact', head: true })
    .eq('seat_map_id', seatMapId)
  if (countErr) throw new Error(`počet sedadiel: ${countErr.message}`)

  const rows = await readAllRows<T>(
    () =>
      db
        .from('seats')
        .select(columns)
        .eq('seat_map_id', seatMapId)
        .order('id', { ascending: true })
        .returns<T[]>(),
    'sedadlá mapy',
  )

  // Rows added while we paged are fine (we simply read them); rows missing are
  // not — that is the truncation this module exists to catch.
  if (count !== null && rows.length < count) {
    throw new Error(
      `Mapu sa nepodarilo načítať celú: ${rows.length} z ${count} sedadiel. ` +
        'Skúste to znova.',
    )
  }
  return rows
}
