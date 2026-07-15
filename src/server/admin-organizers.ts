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

export interface OrganizerAdminDetail {
  organizer: OrganizerRow
  stats: OrganizerStats
  audit: AuditLogRow[]
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

        return { organizer, stats, audit: audit ?? [] }
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
