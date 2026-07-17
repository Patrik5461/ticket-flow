/**
 * Pure validation + date math for manual settlement generation. No IO.
 */

export interface SettlementRangeInput {
  from?: string | null // YYYY-MM-DD inclusive
  to?: string | null // YYYY-MM-DD inclusive
  eventId?: string | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Returns an error message, or null if the input is a valid generation request. */
export function validateSettlementRange(
  input: SettlementRangeInput,
): string | null {
  const hasPeriod = Boolean(input.from && input.to)
  if (!hasPeriod && !input.eventId) {
    return 'Zadajte obdobie (od–do) alebo vyberte podujatie.'
  }
  if (input.from && !DATE_RE.test(input.from)) return 'Neplatný dátum „od".'
  if (input.to && !DATE_RE.test(input.to)) return 'Neplatný dátum „do".'
  if (input.from && input.to && input.from > input.to) {
    return 'Dátum „od" musí byť pred alebo rovný „do".'
  }
  return null
}

/** The calendar day after `dateStr` (YYYY-MM-DD), for an exclusive range end. */
export function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
