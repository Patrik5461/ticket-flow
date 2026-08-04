/**
 * Offset paging for the public program.
 *
 * PostgREST answers at most 1000 rows and says so only in a header, so a
 * listing that just selects everything looks complete right up to the day it
 * silently is not. Every public listing goes through a range instead.
 */

/** Cards per page on /podujatia. Three columns on a wide screen, eight rows. */
export const EVENTS_PAGE_SIZE = 24

/** Events in the landing teaser before it points at the full program. */
export const TEASER_EVENTS = 6

/** Clamps whatever arrived in the URL to a usable page number. */
export function normalizePage(raw: unknown): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number.parseInt(raw, 10)
        : NaN
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(Math.floor(n), 10_000)
}

/** Inclusive `[from, to]` row offsets a PostgREST `.range()` expects. */
export function pageRange(
  page: number,
  pageSize: number,
): { from: number; to: number } {
  const p = normalizePage(page)
  const from = (p - 1) * pageSize
  return { from, to: from + pageSize - 1 }
}

/** Pages a result set spans; always at least one, so "1 z 1" reads sanely. */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize))
}
