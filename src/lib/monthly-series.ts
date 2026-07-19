/**
 * Monthly revenue/fee bucketing for the platform stats. Pure (no DB), keyed by
 * the Europe/Bratislava calendar month, so it is unit-testable.
 */

const TZ = 'Europe/Bratislava'
const monthKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
})

/** Europe/Bratislava 'YYYY-MM' of an instant. */
export function monthKey(d: Date): string {
  // en-CA gives 'YYYY-MM-DD'; take the first 7 chars.
  return monthKeyFmt.format(d).slice(0, 7)
}

export interface MonthlyDatedAmount {
  total_cents: number
  fee_cents: number
  paid_at: string | null
  created_at: string
}

export interface MonthlyPoint {
  month: string // YYYY-MM
  grossCents: number
  feeCents: number
  orders: number
}

/**
 * Zero-filled series for the last `months` calendar months ending on the month
 * of `nowMs` (oldest → newest). Orders are bucketed by paid_at (fallback
 * created_at); anything outside the window is ignored.
 */
export function buildMonthlySeries(
  orders: MonthlyDatedAmount[],
  nowMs: number,
  months = 6,
): MonthlyPoint[] {
  const now = new Date(nowMs)
  const nowKey = monthKey(now)
  const [ny, nm] = nowKey.split('-').map(Number)

  const axis: string[] = []
  const buckets = new Map<string, MonthlyPoint>()
  for (let i = months - 1; i >= 0; i--) {
    // Walk back i months from (ny, nm).
    const total = ny * 12 + (nm - 1) - i
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    const key = `${y}-${String(m).padStart(2, '0')}`
    axis.push(key)
    buckets.set(key, { month: key, grossCents: 0, feeCents: 0, orders: 0 })
  }

  for (const o of orders) {
    const key = monthKey(new Date(o.paid_at ?? o.created_at))
    const b = buckets.get(key)
    if (!b) continue
    b.grossCents += o.total_cents
    b.feeCents += o.fee_cents
    b.orders += 1
  }
  return axis.map((k) => buckets.get(k)!)
}

/**
 * Zero-fill the last `months` months from pre-aggregated per-month buckets (as
 * returned by the admin_platform_stats DB function). Same axis as
 * buildMonthlySeries; months with no bucket render as zero.
 */
export function fillMonthlySeries(
  buckets: MonthlyPoint[],
  nowMs: number,
  months = 6,
): MonthlyPoint[] {
  const map = new Map(buckets.map((b) => [b.month, b]))
  const [ny, nm] = monthKey(new Date(nowMs)).split('-').map(Number)
  const out: MonthlyPoint[] = []
  for (let i = months - 1; i >= 0; i--) {
    const total = ny * 12 + (nm - 1) - i
    const y = Math.floor(total / 12)
    const m = (total % 12) + 1
    const key = `${y}-${String(m).padStart(2, '0')}`
    const b = map.get(key)
    out.push({
      month: key,
      grossCents: b?.grossCents ?? 0,
      feeCents: b?.feeCents ?? 0,
      orders: b?.orders ?? 0,
    })
  }
  return out
}
