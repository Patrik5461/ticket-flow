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

export interface DailyPoint {
  date: string // YYYY-MM-DD (Europe/Bratislava)
  grossCents: number
  orders: number
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

const TZ = 'Europe/Bratislava'
const DAY_MS = 24 * 60 * 60 * 1000
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const dayKey = (d: Date) => dayKeyFmt.format(d)

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

      // 30-day axis (oldest → newest), zero-filled, bucketed in Bratislava time.
      const buckets = new Map<string, { grossCents: number; orders: number }>()
      const axis: string[] = []
      const now = Date.now()
      for (let i = 29; i >= 0; i--) {
        const key = dayKey(new Date(now - i * DAY_MS))
        axis.push(key)
        buckets.set(key, { grossCents: 0, orders: 0 })
      }
      for (const o of orders) {
        const key = dayKey(new Date(o.paid_at ?? o.created_at))
        const b = buckets.get(key)
        if (!b) continue // older than 30 days
        b.grossCents += o.total_cents
        b.orders += 1
      }
      const daily: DailyPoint[] = axis.map((date) => ({
        date,
        grossCents: buckets.get(date)!.grossCents,
        orders: buckets.get(date)!.orders,
      }))

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
