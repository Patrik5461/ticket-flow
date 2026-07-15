/**
 * Daily sales bucketing for the admin overview chart. Pure (no DB / server
 * imports), so it is unit-testable and safe to import from either side.
 *
 * Days are bucketed by the Europe/Bratislava calendar date (not UTC): an order
 * placed at 22:30 UTC belongs to the next Bratislava day in summer (CEST, +2).
 */

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
