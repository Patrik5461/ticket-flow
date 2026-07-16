/**
 * Operational snapshot for the /admin dashboard: pending payouts, recent
 * organizer signups, recent large orders, events in the next 7 days, and a
 * health panel. Read-only, requirePlatformAdmin.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { serviceClient } from '../lib/supabase/server'
import { requirePlatformAdmin, runAdmin } from './admin'

const DAY_MS = 24 * 60 * 60 * 1000

export interface AdminOps {
  pendingPayouts: number
  recentOrganizers: { id: string; name: string; createdAt: string }[]
  largeOrders: {
    id: string
    ref: string
    totalCents: number
    buyerEmail: string
    eventTitle: string
    createdAt: string
  }[]
  upcomingEvents: {
    id: string
    title: string
    organizerName: string
    startsAt: string
    timezone: string
    soldCount: number
    capacity: number
  }[]
  health: {
    organizersActive: number
    organizersSuspended: number
    eventsByStatus: Record<string, number>
  }
}

export const getAdminOpsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminOps | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const db = serviceClient()
      const nowMs = Date.now()
      const in7d = new Date(nowMs + 7 * DAY_MS).toISOString()
      const nowIso = new Date(nowMs).toISOString()
      const largeCutoff = new Date(nowMs - 90 * DAY_MS).toISOString()

      const [
        { count: pendingPayouts },
        { data: organizers },
        { data: events },
        { data: largeOrders },
      ] = await Promise.all([
        db
          .from('payout_requests')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'requested'),
        db
          .from('organizers')
          .select('id, name, status, created_at')
          .order('created_at', { ascending: false })
          .returns<
            { id: string; name: string; status: string; created_at: string }[]
          >(),
        db
          .from('events')
          .select('id, title, organizer_id, starts_at, timezone, status')
          .returns<
            {
              id: string
              title: string
              organizer_id: string
              starts_at: string
              timezone: string
              status: string
            }[]
          >(),
        db
          .from('orders')
          .select('id, total_cents, buyer_email, event_id, created_at')
          .eq('status', 'paid')
          .gte('created_at', largeCutoff)
          .order('total_cents', { ascending: false })
          .limit(5)
          .returns<
            {
              id: string
              total_cents: number
              buyer_email: string
              event_id: string
              created_at: string
            }[]
          >(),
      ])

      const orgs = organizers ?? []
      const evs = events ?? []
      const orgName = new Map(orgs.map((o) => [o.id, o.name]))
      const eventTitle = new Map(evs.map((e) => [e.id, e.title]))

      // Upcoming published events in the next 7 days.
      const upcomingRaw = evs
        .filter(
          (e) =>
            e.status === 'published' &&
            e.starts_at >= nowIso &&
            e.starts_at <= in7d,
        )
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      const upIds = upcomingRaw.map((e) => e.id)
      const cap = new Map<string, { sold: number; capacity: number }>()
      if (upIds.length > 0) {
        const { data: types } = await db
          .from('ticket_types')
          .select('event_id, sold_count, capacity')
          .in('event_id', upIds)
          .returns<
            { event_id: string; sold_count: number; capacity: number }[]
          >()
        for (const t of types ?? []) {
          const c = cap.get(t.event_id) ?? { sold: 0, capacity: 0 }
          c.sold += t.sold_count
          c.capacity += t.capacity
          cap.set(t.event_id, c)
        }
      }

      const eventsByStatus: Record<string, number> = {}
      for (const e of evs) {
        eventsByStatus[e.status] = (eventsByStatus[e.status] ?? 0) + 1
      }

      return {
        pendingPayouts: pendingPayouts ?? 0,
        recentOrganizers: orgs.slice(0, 5).map((o) => ({
          id: o.id,
          name: o.name,
          createdAt: o.created_at,
        })),
        largeOrders: (largeOrders ?? []).map((o) => ({
          id: o.id,
          ref: o.id.slice(0, 8).toUpperCase(),
          totalCents: o.total_cents,
          buyerEmail: o.buyer_email,
          eventTitle: eventTitle.get(o.event_id) ?? '—',
          createdAt: o.created_at,
        })),
        upcomingEvents: upcomingRaw.map((e) => ({
          id: e.id,
          title: e.title,
          organizerName: orgName.get(e.organizer_id) ?? '—',
          startsAt: e.starts_at,
          timezone: e.timezone,
          soldCount: cap.get(e.id)?.sold ?? 0,
          capacity: cap.get(e.id)?.capacity ?? 0,
        })),
        health: {
          organizersActive: orgs.filter((o) => o.status === 'active').length,
          organizersSuspended: orgs.filter((o) => o.status === 'suspended')
            .length,
          eventsByStatus,
        },
      }
    })
  },
)
