/**
 * Event cancellation. Sets the event to 'cancelled' (which also stops new sales,
 * since createOrder requires a published event), then enqueues a refund job per
 * paid order and best-effort drains the queue inline so small events refund
 * immediately; the pg_cron tick retries anything left or failed.
 *
 * Authorized for an owner/admin of the event's organizer or a platform admin.
 * Requires the caller to re-type the event title (double confirmation).
 *
 * Exports only the server fn (+ type); handler imports are stripped from the
 * client bundle.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { writeAuditLog } from './admin'
import { requireEventManager, EventAuthzError } from './event-authz'
import { enqueueEventRefundJobs, processRefundJobs } from './refund-jobs'
import { realJobDeps } from './refund-jobs-runtime'

export interface CancelEventResult {
  ok: true
  enqueued: number
  alreadyCancelled?: boolean
}

async function run<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof EventAuthzError) return { error: e.message }
    throw e
  }
}

export const cancelEventFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        confirmTitle: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<CancelEventResult | { error: string }> => {
    return run(async () => {
      const actorId = await requireEventManager(data.eventId)
      const db = serviceClient()

      const { data: event } = await db
        .from('events')
        .select('id, title, status')
        .eq('id', data.eventId)
        .maybeSingle<{ id: string; title: string; status: string }>()
      if (!event) throw new EventAuthzError('Podujatie sa nenašlo.')

      // Double confirmation: the typed title must match exactly.
      if (data.confirmTitle.trim() !== event.title.trim()) {
        throw new EventAuthzError(
          'Zadaný názov sa nezhoduje s názvom podujatia.',
        )
      }

      const alreadyCancelled = event.status === 'cancelled'
      if (!alreadyCancelled) {
        await db
          .from('events')
          .update({ status: 'cancelled' })
          .eq('id', event.id)
      }

      const enqueued = await enqueueEventRefundJobs(realJobDeps(), event.id)

      if (!alreadyCancelled) {
        await writeAuditLog({
          actorId,
          action: 'event.cancel',
          entityType: 'event',
          entityId: event.id,
          oldValue: { status: event.status },
          newValue: { status: 'cancelled', refund_jobs: enqueued },
        })
      }

      // Best-effort inline drain; the cron tick retries the rest.
      try {
        await processRefundJobs(realJobDeps(), { limit: 50 })
      } catch {
        /* queue persists; retried by cron */
      }

      return { ok: true as const, enqueued, alreadyCancelled }
    })
  })
