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
import { buildDailySeries, dayKey } from '../lib/daily-series'
import type { DailyPoint } from '../lib/daily-series'
import { buildMonthlySeries, monthKey } from '../lib/monthly-series'
import type { MonthlyPoint } from '../lib/monthly-series'

export type { DailyPoint } from '../lib/daily-series'
export type { MonthlyPoint } from '../lib/monthly-series'

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

export const getPlatformStatsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PlatformStats | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const db = serviceClient()

      const [{ data: orders }, { data: events }, { data: organizers }] =
        await Promise.all([
          db
            .from('orders')
            .select('event_id, total_cents, fee_cents, paid_at, created_at')
            .eq('status', 'paid')
            .returns<
              {
                event_id: string
                total_cents: number
                fee_cents: number
                paid_at: string | null
                created_at: string
              }[]
            >(),
          db
            .from('events')
            .select('id, title, organizer_id')
            .returns<{ id: string; title: string; organizer_id: string }[]>(),
          db
            .from('organizers')
            .select('id, name')
            .returns<{ id: string; name: string }[]>(),
        ])
      const paid = orders ?? []
      const eventById = new Map((events ?? []).map((e) => [e.id, e]))
      const orgName = new Map((organizers ?? []).map((o) => [o.id, o.name]))

      const nowMs = Date.now()
      const todayKey = dayKey(new Date(nowMs))
      const thisMonth = monthKey(new Date(nowMs))

      const zero = (): RevenueSlice => ({ grossCents: 0, feeCents: 0 })
      const breakdown = { today: zero(), month: zero(), all: zero() }

      const perEvent = new Map<
        string,
        { grossCents: number; feeCents: number; orders: number }
      >()
      const perOrg = new Map<string, { grossCents: number; feeCents: number }>()

      for (const o of paid) {
        const when = new Date(o.paid_at ?? o.created_at)
        breakdown.all.grossCents += o.total_cents
        breakdown.all.feeCents += o.fee_cents
        if (monthKey(when) === thisMonth) {
          breakdown.month.grossCents += o.total_cents
          breakdown.month.feeCents += o.fee_cents
        }
        if (dayKey(when) === todayKey) {
          breakdown.today.grossCents += o.total_cents
          breakdown.today.feeCents += o.fee_cents
        }

        const pe = perEvent.get(o.event_id) ?? {
          grossCents: 0,
          feeCents: 0,
          orders: 0,
        }
        pe.grossCents += o.total_cents
        pe.feeCents += o.fee_cents
        pe.orders += 1
        perEvent.set(o.event_id, pe)

        const orgId = eventById.get(o.event_id)?.organizer_id
        if (orgId) {
          const po = perOrg.get(orgId) ?? { grossCents: 0, feeCents: 0 }
          po.grossCents += o.total_cents
          po.feeCents += o.fee_cents
          perOrg.set(orgId, po)
        }
      }

      const monthly = buildMonthlySeries(paid, nowMs, 6)

      const topOrganizers: TopOrganizer[] = [...perOrg.entries()]
        .map(([id, v]) => ({ id, name: orgName.get(id) ?? '—', ...v }))
        .sort((a, b) => b.grossCents - a.grossCents)
        .slice(0, 5)

      const topEvents: TopEvent[] = [...perEvent.entries()]
        .map(([id, v]) => {
          const ev = eventById.get(id)
          return {
            id,
            title: ev?.title ?? '—',
            organizerName: ev ? (orgName.get(ev.organizer_id) ?? '—') : '—',
            grossCents: v.grossCents,
            orderCount: v.orders,
          }
        })
        .sort((a, b) => b.grossCents - a.grossCents)
        .slice(0, 5)

      return { breakdown, monthly, topOrganizers, topEvents }
    })
  },
)
