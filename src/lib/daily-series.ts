/**
 * Daily sales bucketing for the admin overview chart. Pure (no DB / server
 * imports), so it is unit-testable and safe to import from either side.
 *
 * Days are bucketed by the Europe/Bratislava calendar date (not UTC): an order
 * placed at 22:30 UTC belongs to the next Bratislava day in summer (CEST, +2).
 */

import { zonedLocalToUtcIso } from './datetime'

export interface DailyPoint {
  date: string // YYYY-MM-DD (Europe/Bratislava)
  grossCents: number
  orders: number
}

/** Minimal shape needed to place + weight an order on the timeline. */
export interface DatedAmount {
  total_cents: number
  paid_at: string | null
  created_at: string
}

const TZ = 'Europe/Bratislava'
const DAY_MS = 24 * 60 * 60 * 1000
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The Europe/Bratislava calendar date of an instant, as 'YYYY-MM-DD'. */
export function dayKey(d: Date): string {
  return dayKeyFmt.format(d)
}

/**
 * Build a zero-filled daily series for the `days`-day window ending on the
 * Bratislava date of `nowMs` (oldest → newest). Each order is bucketed by its
 * paid_at (falling back to created_at) Bratislava date; orders outside the window
 * are ignored.
 */
export function buildDailySeries(
  orders: DatedAmount[],
  nowMs: number,
  days = 30,
): DailyPoint[] {
  const buckets = new Map<string, { grossCents: number; orders: number }>()
  const axis: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(new Date(nowMs - i * DAY_MS))
    axis.push(key)
    buckets.set(key, { grossCents: 0, orders: 0 })
  }
  for (const o of orders) {
    const key = dayKey(new Date(o.paid_at ?? o.created_at))
    const b = buckets.get(key)
    if (!b) continue // outside the window
    b.grossCents += o.total_cents
    b.orders += 1
  }
  return axis.map((date) => ({
    date,
    grossCents: buckets.get(date)!.grossCents,
    orders: buckets.get(date)!.orders,
  }))
}

/**
 * Zero-fill a `days`-day window from pre-aggregated per-day buckets (as returned
 * by the admin_overview_stats DB function). Same axis as buildDailySeries; days
 * with no bucket render as zero.
 */
export function fillDailySeries(
  buckets: DailyPoint[],
  nowMs: number,
  days = 30,
): DailyPoint[] {
  const map = new Map(buckets.map((b) => [b.date, b]))
  const out: DailyPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = dayKey(new Date(nowMs - i * DAY_MS))
    const b = map.get(date)
    out.push({ date, grossCents: b?.grossCents ?? 0, orders: b?.orders ?? 0 })
  }
  return out
}

// ---------------------------------------------------------------------------
// Phase 24 — the organizer's sales-over-time chart.
//
// Same bucketing discipline as above (Europe/Bratislava calendar, never UTC),
// extended with an hourly axis for the event day and an arbitrary day range for
// the pre-sale period. DST is handled by walking real instants and reading their
// local labels back, so a 23-hour or 25-hour day produces 23 or 25 buckets
// instead of a wrong 24.
// ---------------------------------------------------------------------------

export interface SeriesPoint {
  /** Bucket id: 'YYYY-MM-DD' (daily) or 'YYYY-MM-DDTHH' (hourly). */
  key: string
  /** Axis label: '5.7.' or '14:00'. */
  label: string
  grossCents: number
  orders: number
  tickets: number
}

/** One order placed on the timeline. `tickets` is the sum of item quantities. */
export interface DatedOrder extends DatedAmount {
  tickets: number
}

const HOUR_MS = 60 * 60 * 1000

function partsIn(d: Date, timeZone: string): Record<string, string> {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  })
  const p: Record<string, string> = {}
  for (const part of dtf.formatToParts(d)) p[part.type] = part.value
  if (p.hour === '24') p.hour = '00'
  return p
}

/** Local calendar date of an instant in `timeZone`, as 'YYYY-MM-DD'. */
export function dayKeyIn(d: Date, timeZone: string): string {
  const p = partsIn(d, timeZone)
  return `${p.year}-${p.month}-${p.day}`
}

/** Local hour bucket of an instant, as 'YYYY-MM-DDTHH'. */
export function hourKeyIn(d: Date, timeZone: string): string {
  const p = partsIn(d, timeZone)
  return `${p.year}-${p.month}-${p.day}T${p.hour}`
}

/** UTC instant of local midnight starting `dayKey` in `timeZone`. */
function localMidnightMs(day: string, timeZone: string): number {
  return Date.parse(zonedLocalToUtcIso(`${day}T00:00`, timeZone))
}

function emptyPoint(key: string, label: string): SeriesPoint {
  return { key, label, grossCents: 0, orders: 0, tickets: 0 }
}

function accumulate(points: SeriesPoint[], keyOf: (o: DatedOrder) => string, orders: DatedOrder[]): SeriesPoint[] {
  const byKey = new Map(points.map((p) => [p.key, p]))
  for (const o of orders) {
    const bucket = byKey.get(keyOf(o))
    if (!bucket) continue // outside the window
    bucket.grossCents += o.total_cents
    bucket.orders += 1
    bucket.tickets += o.tickets
  }
  return points
}

/**
 * Zero-filled hourly series for one local day (the event day). Walks real
 * instants from local midnight, so the axis is 23 / 24 / 25 buckets depending on
 * DST, and a repeated wall-clock hour merges into one bucket.
 */
export function buildHourlySeries(
  orders: DatedOrder[],
  day: string,
  timeZone: string,
): SeriesPoint[] {
  const start = localMidnightMs(day, timeZone)
  const points: SeriesPoint[] = []
  const seen = new Set<string>()
  for (let i = 0; i < 26; i++) {
    const at = new Date(start + i * HOUR_MS)
    if (dayKeyIn(at, timeZone) !== day) break
    const key = hourKeyIn(at, timeZone)
    if (seen.has(key)) continue // repeated hour on a DST fall-back day
    seen.add(key)
    points.push(emptyPoint(key, `${key.slice(11)}:00`))
  }
  return accumulate(
    points,
    (o) => hourKeyIn(new Date(o.paid_at ?? o.created_at), timeZone),
    orders,
  )
}

/**
 * Zero-filled daily series between two local dates (inclusive). Steps at local
 * noon so a DST change can never skip or duplicate a day.
 */
export function buildDayRangeSeries(
  orders: DatedOrder[],
  fromDayKey: string,
  toDayKey: string,
  timeZone: string,
  maxDays = 120,
): SeriesPoint[] {
  const noon = Date.parse(zonedLocalToUtcIso(`${fromDayKey}T12:00`, timeZone))
  const points: SeriesPoint[] = []
  for (let i = 0; i < maxDays; i++) {
    const key = dayKeyIn(new Date(noon + i * DAY_MS), timeZone)
    const [, m, d] = key.split('-')
    points.push(emptyPoint(key, `${Number(d)}.${Number(m)}.`))
    if (key >= toDayKey) break
  }
  return accumulate(
    points,
    (o) => dayKeyIn(new Date(o.paid_at ?? o.created_at), timeZone),
    orders,
  )
}
