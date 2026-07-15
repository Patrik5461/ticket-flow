/**
 * Platform-admin server fns for events: cross-organizer list + moderation
 * (force-unpublish). Guarded by requirePlatformAdmin; the unpublish action is
 * audited. Exports only server fns (+ types) so the client bridge strips the
 * admin.ts / getCurrentUser imports.
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
import type { EventStatus } from '../lib/db-types'

export interface AdminEventItem {
  id: string
  title: string
  slug: string
  status: EventStatus
  starts_at: string
  timezone: string
  organizerId: string
  organizerName: string
  soldCount: number
  capacity: number
  grossCents: number
}

interface RawEvent {
  id: string
  title: string
  slug: string
  status: EventStatus
  starts_at: string
  timezone: string
  organizer_id: string
  organizers: { name: string } | null
}

export const listAllEventsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminEventItem[] | { error: string }> => {
    return runAdmin(async () => {
      await requirePlatformAdmin()
      const db = serviceClient()

      const [{ data: events }, { data: types }, { data: orders }] =
        await Promise.all([
          db
            .from('events')
            .select(
              'id, title, slug, status, starts_at, timezone, organizer_id, organizers(name)',
            )
            .order('starts_at', { ascending: false })
            .returns<RawEvent[]>(),
          db
            .from('ticket_types')
            .select('event_id, sold_count, capacity')
            .returns<
              { event_id: string; sold_count: number; capacity: number }[]
            >(),
          db
            .from('orders')
            .select('event_id, total_cents, status')
            .eq('status', 'paid')
            .returns<{ event_id: string; total_cents: number }[]>(),
        ])

      const sold = new Map<string, { sold: number; cap: number }>()
      for (const t of types ?? []) {
        const s = sold.get(t.event_id) ?? { sold: 0, cap: 0 }
        s.sold += t.sold_count
        s.cap += t.capacity
        sold.set(t.event_id, s)
      }
      const gross = new Map<string, number>()
      for (const o of orders ?? []) {
        gross.set(o.event_id, (gross.get(o.event_id) ?? 0) + o.total_cents)
      }

      return (events ?? []).map((e) => ({
        id: e.id,
        title: e.title,
        slug: e.slug,
        status: e.status,
        starts_at: e.starts_at,
        timezone: e.timezone,
        organizerId: e.organizer_id,
        organizerName: e.organizers?.name ?? '—',
        soldCount: sold.get(e.id)?.sold ?? 0,
        capacity: sold.get(e.id)?.cap ?? 0,
        grossCents: gross.get(e.id) ?? 0,
      }))
    })
  },
)

/** Moderation take-down: force a published event back to draft. */
export const adminUnpublishEventFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    return runAdmin(async () => {
      const admin = await requirePlatformAdmin()
      const db = serviceClient()
      const { data: event } = await db
        .from('events')
        .select('id, status')
        .eq('id', data.eventId)
        .maybeSingle<{ id: string; status: EventStatus }>()
      if (!event) throw new AdminError('Podujatie sa nenašlo.')
      if (event.status !== 'published') return { ok: true } as const

      const { error } = await db
        .from('events')
        .update({ status: 'draft' })
        .eq('id', data.eventId)
      if (error) throw new AdminError('Podujatie sa nepodarilo skryť.')

      await writeAuditLog({
        actorId: admin.userId,
        action: 'event.admin_unpublish',
        entityType: 'event',
        entityId: data.eventId,
        oldValue: { status: 'published' },
        newValue: { status: 'draft' },
      })
      return { ok: true } as const
    })
  })
