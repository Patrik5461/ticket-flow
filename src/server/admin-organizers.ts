/**
 * Platform-admin server fns for organizers: list, detail, fee/status/notes edits.
 * Every mutation is gated by requirePlatformAdmin and writes an audit_log row.
 *
 * Exports ONLY server fns (+ types), so the createServerFn bridge strips the
 * handlers and their admin.ts / getCurrentUser imports from the client bundle
 * (the admin.organizers routes import this module).
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import {
  requirePlatformAdmin,
  runAdmin,
  writeAuditLog,
  AdminError,
} from './admin'
import type {
  OrganizerRow,
  OrganizerStatus,
  AuditLogRow,
} from '../lib/db-types'
import { buildDailySeries, dayKey } from '../lib/daily-series'
import type { DailyPoint } from '../lib/daily-series'

export interface OrganizerStats {
  eventCount: number
  paidOrders: number
  grossCents: number
  feeCents: number
}

export interface OrganizerListItem extends OrganizerStats {
  id: string
  name: string
  slug: string
  status: OrganizerStatus
  fee_percent: number
  fee_min_cents: number
}

/** An audit row with the actor's email resolved for display. */
export interface AuditEntryView extends AuditLogRow {
  actorEmail: string | null
}

export interface OrganizerAdminDetail {
  organizer: OrganizerRow
  stats: OrganizerStats
  audit: AuditEntryView[]
}

/** Resolve actor_id → email for a batch of audit rows (distinct ids only). */
async function withActorEmails(rows: AuditLogRow[]): Promise<AuditEntryView[]> {
  const db = serviceClient()
  const ids = [
    ...new Set(rows.map((r) => r.actor_id).filter(Boolean)),
  ] as string[]
  const emailById = new Map<string, string | null>()
  for (const id of ids) {
    const { data } = await db.auth.admin.getUserById(id)
    emailById.set(id, data.user?.email ?? null)
  }
  return rows.map((r) => ({
    ...r,
    actorEmail: r.actor_id ? (emailById.get(r.actor_id) ?? null) : null,
  }))
}

/** Aggregate paid-order stats per organizer, in a handful of queries (admin-only,
 *  so N+1 is avoided by joining in memory rather than per-organizer round trips). */
async function statsByOrganizer(): Promise<Map<string, OrganizerStats>> {
  const db = serviceClient()
  const [{ data: events }, { data: orders }] = await Promise.all([
    db
      .from('events')
      .select('id, organizer_id')
      .returns<{ id: string; organizer_id: string }[]>(),
    db
      .from('orders')
      .select('event_id, status, total_cents, fee_cents')
      .eq('status', 'paid')
      .returns<
        { event_id: string; total_cents: number; fee_cents: number }[]
      >(),
  ])

  const orgOfEvent = new Map<string, string>()
  const stats = new Map<string, OrganizerStats>()
  const ensure = (org: string) => {
    let s = stats.get(org)
    if (!s) {
      s = { eventCount: 0, paidOrders: 0, grossCents: 0, feeCents: 0 }
      stats.set(org, s)
    }
    return s
  }
  for (const e of events ?? []) {
    orgOfEvent.set(e.id, e.organizer_id)
    ensure(e.organizer_id).eventCount++
  }
  for (const o of orders ?? []) {
    const org = orgOfEvent.get(o.event_id)
    if (!org) continue
    const s = ensure(org)
    s.paidOrders++
    s.grossCents += o.total_cents
    s.feeCents += o.fee_cents
  }
  return stats
}

const ZERO: OrganizerStats = {
  eventCount: 0,
  paidOrders: 0,
  grossCents: 0,
  feeCents: 0,
}

export const listOrganizersFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<OrganizerListItem[] | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const db = serviceClient()
      const { data: organizers } = await db
        .from('organizers')
        .select('id, name, slug, status, fee_percent, fee_min_cents')
        .order('name', { ascending: true })
        .returns<
          Pick<
            OrganizerRow,
            'id' | 'name' | 'slug' | 'status' | 'fee_percent' | 'fee_min_cents'
          >[]
        >()
      const stats = await statsByOrganizer()
      return (organizers ?? []).map((o) => ({
        ...o,
        ...(stats.get(o.id) ?? ZERO),
      }))
    })
  },
)

export const getOrganizerAdminFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z.object({ organizerId: z.string().uuid() }).parse(d),
  )
  .handler(
    async ({ data }): Promise<OrganizerAdminDetail | { error: string }> => {
      return runAdmin(async () => {
        await requirePlatformAdmin()
        const db = serviceClient()
        const { data: organizer } = await db
          .from('organizers')
          .select('*')
          .eq('id', data.organizerId)
          .maybeSingle<OrganizerRow>()
        if (!organizer) throw new AdminError('Organizátor sa nenašiel.')

        const stats = (await statsByOrganizer()).get(organizer.id) ?? ZERO

        const { data: audit } = await db
          .from('audit_log')
          .select('*')
          .eq('entity_type', 'organizer')
          .eq('entity_id', organizer.id)
          .order('created_at', { ascending: false })
          .limit(30)
          .returns<AuditLogRow[]>()

        return {
          organizer,
          stats,
          audit: await withActorEmails(audit ?? []),
        }
      })
    },
  )

/** Load an organizer or throw. Small helper shared by the mutations below. */
async function loadOrganizer(id: string): Promise<OrganizerRow> {
  const { data } = await serviceClient()
    .from('organizers')
    .select('*')
    .eq('id', id)
    .maybeSingle<OrganizerRow>()
  if (!data) throw new AdminError('Organizátor sa nenašiel.')
  return data
}

export const updateOrganizerFeeFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        organizerId: z.string().uuid(),
        // Percent as a number with up to 2 decimals, 0–100.
        feePercent: z.number().min(0).max(100),
        feeMinCents: z.number().int().min(0),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const before = await loadOrganizer(data.organizerId)
      // Round percent to 2 decimals to match the numeric(5,2) column.
      const feePercent = Math.round(data.feePercent * 100) / 100
      const { error } = await serviceClient()
        .from('organizers')
        .update({ fee_percent: feePercent, fee_min_cents: data.feeMinCents })
        .eq('id', data.organizerId)
      if (error) throw new AdminError('Províziu sa nepodarilo uložiť.')

      await writeAuditLog({
        actorId: admin.userId,
        action: 'organizer.update_fee',
        entityType: 'organizer',
        entityId: data.organizerId,
        oldValue: {
          fee_percent: before.fee_percent,
          fee_min_cents: before.fee_min_cents,
        },
        newValue: { fee_percent: feePercent, fee_min_cents: data.feeMinCents },
      })
      return { ok: true } as const
    })
  })

export const setOrganizerStatusFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        organizerId: z.string().uuid(),
        status: z.enum(['active', 'suspended']),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const before = await loadOrganizer(data.organizerId)
      if (before.status === data.status) return { ok: true } as const

      const { error } = await serviceClient()
        .from('organizers')
        .update({ status: data.status })
        .eq('id', data.organizerId)
      if (error) throw new AdminError('Stav organizátora sa nepodarilo zmeniť.')

      await writeAuditLog({
        actorId: admin.userId,
        action:
          data.status === 'suspended'
            ? 'organizer.suspend'
            : 'organizer.activate',
        entityType: 'organizer',
        entityId: data.organizerId,
        oldValue: { status: before.status },
        newValue: { status: data.status },
      })
      return { ok: true } as const
    })
  })

export const updateOrganizerNotesFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        organizerId: z.string().uuid(),
        notes: z.string().max(5000).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const before = await loadOrganizer(data.organizerId)
      const notes = data.notes?.trim() || null
      const { error } = await serviceClient()
        .from('organizers')
        .update({ admin_notes: notes })
        .eq('id', data.organizerId)
      if (error) throw new AdminError('Poznámku sa nepodarilo uložiť.')

      await writeAuditLog({
        actorId: admin.userId,
        action: 'organizer.update_notes',
        entityType: 'organizer',
        entityId: data.organizerId,
        oldValue: { admin_notes: before.admin_notes },
        newValue: { admin_notes: notes },
      })
      return { ok: true } as const
    })
  })

// ---------------------------------------------------------------------------
// Detailed organizer stats: chart, per-event breakdown, totals.
// ---------------------------------------------------------------------------

export interface OrganizerEventSales {
  id: string
  title: string
  starts_at: string
  status: string
  soldCount: number
  capacity: number
  grossCents: number
  feeCents: number
  orderCount: number
  isPast: boolean
}

export interface OrganizerStatsDetail {
  daily: DailyPoint[]
  events: OrganizerEventSales[]
  totals: {
    grossCents: number
    feeCents: number
    netCents: number
    orderCount: number
    avgOrderCents: number
  }
}

export const getOrganizerStatsFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z
      .object({
        organizerId: z.string().uuid(),
        period: z.enum(['30d', '90d', 'all']).default('30d'),
      })
      .parse(d),
  )
  .handler(
    async ({ data }): Promise<OrganizerStatsDetail | { error: string }> => {
      return runAdmin(async () => {
        await requirePlatformAdmin()
        const db = serviceClient()

        const { data: events } = await db
          .from('events')
          .select('id, title, starts_at, ends_at, status')
          .eq('organizer_id', data.organizerId)
          .order('starts_at', { ascending: false })
          .returns<
            {
              id: string
              title: string
              starts_at: string
              ends_at: string | null
              status: string
            }[]
          >()
        const evs = events ?? []
        const eventIds = evs.map((e) => e.id)

        const empty: OrganizerStatsDetail = {
          daily: buildDailySeries([], Date.now(), 30),
          events: [],
          totals: {
            grossCents: 0,
            feeCents: 0,
            netCents: 0,
            orderCount: 0,
            avgOrderCents: 0,
          },
        }
        if (eventIds.length === 0) return empty

        const [{ data: orders }, { data: types }] = await Promise.all([
          db
            .from('orders')
            .select('event_id, total_cents, fee_cents, paid_at, created_at')
            .in('event_id', eventIds)
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
            .from('ticket_types')
            .select('event_id, sold_count, capacity')
            .in('event_id', eventIds)
            .returns<
              { event_id: string; sold_count: number; capacity: number }[]
            >(),
        ])
        const paid = orders ?? []

        // Chart window: fixed for 30d/90d; for 'all' span from earliest order.
        let days = 30
        if (data.period === '90d') days = 90
        else if (data.period === 'all') {
          const earliest = paid.reduce((min, o) => {
            const t = new Date(o.paid_at ?? o.created_at).getTime()
            return t < min ? t : min
          }, Date.now())
          const span = Math.ceil(
            (Date.now() - earliest) / (24 * 60 * 60 * 1000),
          )
          days = Math.min(365, Math.max(30, span + 1))
        }
        const daily = buildDailySeries(paid, Date.now(), days)

        // Per-event aggregation.
        const byEvent = new Map<
          string,
          { grossCents: number; feeCents: number; orderCount: number }
        >()
        for (const o of paid) {
          const b = byEvent.get(o.event_id) ?? {
            grossCents: 0,
            feeCents: 0,
            orderCount: 0,
          }
          b.grossCents += o.total_cents
          b.feeCents += o.fee_cents
          b.orderCount += 1
          byEvent.set(o.event_id, b)
        }
        const cap = new Map<string, { sold: number; capacity: number }>()
        for (const t of types ?? []) {
          const c = cap.get(t.event_id) ?? { sold: 0, capacity: 0 }
          c.sold += t.sold_count
          c.capacity += t.capacity
          cap.set(t.event_id, c)
        }

        const todayKey = dayKey(new Date())
        const eventRows: OrganizerEventSales[] = evs.map((e) => {
          const b = byEvent.get(e.id)
          const c = cap.get(e.id)
          const endKey = dayKey(new Date(e.ends_at ?? e.starts_at))
          return {
            id: e.id,
            title: e.title,
            starts_at: e.starts_at,
            status: e.status,
            soldCount: c?.sold ?? 0,
            capacity: c?.capacity ?? 0,
            grossCents: b?.grossCents ?? 0,
            feeCents: b?.feeCents ?? 0,
            orderCount: b?.orderCount ?? 0,
            isPast: endKey < todayKey,
          }
        })

        let grossCents = 0
        let feeCents = 0
        for (const o of paid) {
          grossCents += o.total_cents
          feeCents += o.fee_cents
        }
        const orderCount = paid.length

        return {
          daily,
          events: eventRows,
          totals: {
            grossCents,
            feeCents,
            netCents: grossCents - feeCents,
            orderCount,
            avgOrderCents:
              orderCount > 0 ? Math.round(grossCents / orderCount) : 0,
          },
        }
      })
    },
  )
