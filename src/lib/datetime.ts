/**
 * Timezone helpers. DB stores UTC (timestamptz); organizers enter/see wall-clock
 * time in the event timezone (default Europe/Bratislava). No external tz lib —
 * we derive the zone offset at the given instant via Intl, which is DST-correct.
 */

/** Offset (ms) of `timeZone` at the given instant: zonedWallClock - utc. */
function offsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(instant)) p[part.type] = part.value
  // Some environments render midnight hour as '24'; normalize to '00'.
  const hour = p.hour === '24' ? '00' : p.hour
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(hour),
    Number(p.minute),
    Number(p.second),
  )
  return asUtc - instant.getTime()
}

/**
 * Interpret a `datetime-local` string ("YYYY-MM-DDTHH:mm") as wall-clock time in
 * `timeZone` and return the corresponding UTC ISO string.
 */
export function zonedLocalToUtcIso(local: string, timeZone: string): string {
  // Pretend the wall time is already UTC, then subtract the zone offset at that instant.
  const naiveUtc = new Date(`${local}:00Z`).getTime()
  const offset = offsetMs(new Date(naiveUtc), timeZone)
  return new Date(naiveUtc - offset).toISOString()
}

/**
 * Format a UTC ISO string as a `datetime-local` value ("YYYY-MM-DDTHH:mm") in
 * `timeZone`, for pre-filling form inputs.
 */
export function utcIsoToZonedLocal(iso: string, timeZone: string): string {
  const d = new Date(iso)
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(d)) p[part.type] = part.value
  const hour = p.hour === '24' ? '00' : p.hour
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`
}

// --- Display formatting (deterministic across JS engines) --------------------
// Node's ICU (SSR) and the browser's ICU (Safari in particular) disagree on
// sk-SK month/weekday names and separators, producing DIFFERENT strings for the
// same instant ("streda 29. júla 2026 o 22:09" vs "streda, 29. júla 2026,
// 22:09"). Rendered in a hydrated component that is a React hydration text
// mismatch (#418) which throws and breaks the page on mobile Safari. So we build
// the string ourselves: only NUMERIC parts come from Intl (digits are identical
// across engines), every locale word/separator comes from the tables below —
// SSR and client therefore always produce byte-identical output.

const SK_WEEKDAYS = [
  'nedeľa',
  'pondelok',
  'utorok',
  'streda',
  'štvrtok',
  'piatok',
  'sobota',
] as const
// Genitive case — used inside a full date ("29. júla 2026").
const SK_MONTHS_GENITIVE = [
  'januára',
  'februára',
  'marca',
  'apríla',
  'mája',
  'júna',
  'júla',
  'augusta',
  'septembra',
  'októbra',
  'novembra',
  'decembra',
] as const
// Nominative case — used standalone ("júl 2026").
const SK_MONTHS_NOMINATIVE = [
  'január',
  'február',
  'marec',
  'apríl',
  'máj',
  'jún',
  'júl',
  'august',
  'september',
  'október',
  'november',
  'december',
] as const
const SK_MONTHS_SHORT = [
  'jan',
  'feb',
  'mar',
  'apr',
  'máj',
  'jún',
  'júl',
  'aug',
  'sep',
  'okt',
  'nov',
  'dec',
] as const

export type SkDateStyle =
  | 'full' // streda 29. júla 2026 o 22:09
  | 'long' // 29. júla 2026 o 22:09
  | 'dateTime' // 29. 7. 2026, 22:09
  | 'dateTimeSec' // 29. 7. 2026, 22:09:07
  | 'date' // 29. 7. 2026
  | 'time' // 22:09
  | 'timeSec' // 22:09:07
  | 'dayMonth' // 29. júl
  | 'monthYear' // júl 2026

function zonedParts(iso: string, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(new Date(iso))) p[part.type] = part.value
  const y = Number(p.year)
  const mo = Number(p.month)
  const d = Number(p.day)
  return {
    y,
    mo,
    d,
    hh: p.hour === '24' ? '00' : p.hour,
    mm: p.minute,
    ss: p.second,
    // Weekday of the wall-clock calendar date — engine-independent (pure math).
    wd: new Date(Date.UTC(y, mo - 1, d)).getUTCDay(),
  }
}

/**
 * Format a UTC ISO instant as a Slovak date/time string in `timeZone`
 * (default Europe/Bratislava). Deterministic across JS engines, so it is safe
 * to render directly in hydrated components — see the note above.
 */
export function formatSk(
  iso: string,
  style: SkDateStyle,
  timeZone = 'Europe/Bratislava',
): string {
  const { y, mo, d, hh, mm, ss, wd } = zonedParts(iso, timeZone)
  const time = `${hh}:${mm}`
  const timeSec = `${time}:${ss}`
  switch (style) {
    case 'full':
      return `${SK_WEEKDAYS[wd]} ${d}. ${SK_MONTHS_GENITIVE[mo - 1]} ${y} o ${time}`
    case 'long':
      return `${d}. ${SK_MONTHS_GENITIVE[mo - 1]} ${y} o ${time}`
    case 'dateTime':
      return `${d}. ${mo}. ${y}, ${time}`
    case 'dateTimeSec':
      return `${d}. ${mo}. ${y}, ${timeSec}`
    case 'date':
      return `${d}. ${mo}. ${y}`
    case 'time':
      return time
    case 'timeSec':
      return timeSec
    case 'dayMonth':
      return `${d}. ${SK_MONTHS_SHORT[mo - 1]}`
    case 'monthYear':
      return `${SK_MONTHS_NOMINATIVE[mo - 1]} ${y}`
  }
}
