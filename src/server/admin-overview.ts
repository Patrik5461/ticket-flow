/**
 * Platform overview for /admin: all-time realized revenue + platform fees, entity
 * counts, and a 30-day daily sales series. Read-only, guarded by
 * requirePlatformAdmin. Exports only the server fn (+ type).
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { serviceClient } from '../lib/supabase/server'
import { requirePlatformAdmin, runAdmin } from './admin'
import { fillDailySeries } from '../lib/daily-series'
import type { DailyPoint } from '../lib/daily-series'
import { fillMonthlySeries } from '../lib/monthly-series'
import type { MonthlyPoint } from '../lib/monthly-series'

export type { DailyPoint } from '../lib/daily-series'
export type { MonthlyPoint } from '../lib/monthly-series'

// These aggregate functions return a single JSON object and are not in the
// generated Supabase types yet, so call rpc through a loose signature and type
// the JSON result ourselves.
type RpcResult = { data: unknown; error: { message: string } | null }
function callRpc(
  db: ReturnType<typeof serviceClient>,
  name: string,
  args?: Record<string, unknown>,
): Promise<RpcResult> {
  const rpc = db.rpc as unknown as (
    n: string,
    a?: Record<string, unknown>,
  ) => Promise<RpcResult>
  return rpc(name, args)
}

export interface AdminOverview {
  grossCents: number
  feeCents: number
  netCents: number
  organizerCount: number
  eventCount: number
  orderCount: number
  paidOrderCount: number
  daily: DailyPoint[]
}

interface OverviewStatsRpc {
  grossCents: number
  feeCents: number
  paidCount: number
  daily: DailyPoint[] | null
}

export const getAdminOverviewFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminOverview | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const db = serviceClient()

      // Counts are cheap head queries; the money totals + daily series are
      // aggregated in the DB (admin_overview_stats) so this never pulls the
      // whole orders table into the server process.
      const [
        { count: organizerCount },
        { count: eventCount },
        { count: orderCount },
        statsRes,
      ] = await Promise.all([
        db.from('organizers').select('*', { count: 'exact', head: true }),
        db.from('events').select('*', { count: 'exact', head: true }),
        db.from('orders').select('*', { count: 'exact', head: true }),
        callRpc(db, 'admin_overview_stats', { p_days: 30 }),
      ])
      if (statsRes.error) return { error: 'Súhrn sa nepodarilo načítať.' }

      const s = (statsRes.data as OverviewStatsRpc | null) ?? {
        grossCents: 0,
        feeCents: 0,
        paidCount: 0,
        daily: [],
      }
      const daily = fillDailySeries(s.daily ?? [], Date.now(), 30)

      return {
        grossCents: s.grossCents,
        feeCents: s.feeCents,
        netCents: s.grossCents - s.feeCents,
        organizerCount: organizerCount ?? 0,
        eventCount: eventCount ?? 0,
        orderCount: orderCount ?? 0,
        paidOrderCount: s.paidCount,
        daily,
      }
    })
  },
)

// ---------------------------------------------------------------------------
// Extended platform stats: revenue breakdown, monthly fee trend, top lists.
// ---------------------------------------------------------------------------

export interface RevenueSlice {
  grossCents: number
  feeCents: number
}

export interface TopOrganizer {
  id: string
  name: string
  grossCents: number
  feeCents: number
}

export interface TopEvent {
  id: string
  title: string
  organizerName: string
  grossCents: number
  orderCount: number
}

export interface PlatformStats {
  breakdown: { today: RevenueSlice; month: RevenueSlice; all: RevenueSlice }
  monthly: MonthlyPoint[]
  topOrganizers: TopOrganizer[]
  topEvents: TopEvent[]
}

interface PlatformStatsRpc {
  breakdown: { today: RevenueSlice; month: RevenueSlice; all: RevenueSlice }
  monthly: MonthlyPoint[] | null
  topOrganizers: TopOrganizer[] | null
  topEvents: TopEvent[] | null
}

export const getPlatformStatsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PlatformStats | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      // Fully aggregated in the DB (admin_platform_stats): breakdown, monthly
      // series, and top lists — no full orders scan in the server process.
      const res = await callRpc(serviceClient(), 'admin_platform_stats')
      if (res.error || !res.data) {
        return { error: 'Štatistiky sa nepodarilo načítať.' }
      }
      const data = res.data as PlatformStatsRpc

      return {
        breakdown: data.breakdown,
        monthly: fillMonthlySeries(data.monthly ?? [], Date.now(), 6),
        topOrganizers: data.topOrganizers ?? [],
        topEvents: data.topEvents ?? [],
      }
    })
  },
)
