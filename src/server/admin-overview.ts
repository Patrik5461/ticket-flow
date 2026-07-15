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
import { buildDailySeries } from '../lib/daily-series'
import type { DailyPoint } from '../lib/daily-series'

export type { DailyPoint } from '../lib/daily-series'

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

export const getAdminOverviewFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminOverview | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const db = serviceClient()

      const [
        { count: organizerCount },
        { count: eventCount },
        { count: orderCount },
        { data: paidOrders },
      ] = await Promise.all([
        db.from('organizers').select('*', { count: 'exact', head: true }),
        db.from('events').select('*', { count: 'exact', head: true }),
        db.from('orders').select('*', { count: 'exact', head: true }),
        db
          .from('orders')
          .select('total_cents, fee_cents, paid_at, created_at')
          .eq('status', 'paid')
          .returns<
            {
              total_cents: number
              fee_cents: number
              paid_at: string | null
              created_at: string
            }[]
          >(),
      ])

      const orders = paidOrders ?? []
      let grossCents = 0
      let feeCents = 0
      for (const o of orders) {
        grossCents += o.total_cents
        feeCents += o.fee_cents
      }

      const daily: DailyPoint[] = buildDailySeries(orders, Date.now())

      return {
        grossCents,
        feeCents,
        netCents: grossCents - feeCents,
        organizerCount: organizerCount ?? 0,
        eventCount: eventCount ?? 0,
        orderCount: orderCount ?? 0,
        paidOrderCount: orders.length,
        daily,
      }
    })
  },
)
