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
