/**
 * Organizer broadcast to an event's paid buyers. sendBulkMessageFn records a
 * bulk_messages campaign and enqueues one 'bulk' email_job per distinct paid buyer
 * (deduped per campaign); the existing email worker delivers them with retries and
 * per-tick throttling. listBulkMessagesFn returns the send log with delivery counts.
 *
 * Exports server fns (+ a pure, tested job-row builder). Authorized for an
 * owner/admin of the event's organizer (or a platform admin).
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requireEventManager, EventAuthzError } from './event-authz'
import { bulkMessageEmail } from '../lib/email/templates'

const MAX_RECIPIENTS = 5000

async function run<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof EventAuthzError) return { error: e.message }
    throw e
  }
}

export interface BulkJobRow {
  kind: 'bulk'
  recipient: string
  event_id: string
  campaign_id: string
  subject: string
  html: string
  dedup_key: string
}

/** Pure: build one deduped 'bulk' email_job per recipient for a campaign. */
export function bulkJobRows(args: {
  campaignId: string
  eventId: string
  emails: string[]
  subject: string
  html: string
}): BulkJobRow[] {
  return args.emails.map((to) => ({
    kind: 'bulk',
    recipient: to,
    event_id: args.eventId,
    campaign_id: args.campaignId,
    subject: args.subject,
    html: args.html,
    dedup_key: `bulk:${args.campaignId}:${to}`,
  }))
}

export const sendBulkMessageFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        subject: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(5000),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; recipientCount: number } | { error: string }> => {
      return run(async () => {
        const actorId = await requireEventManager(data.eventId)
        const db = serviceClient()

        const { data: event } = await db
          .from('events')
          .select('title')
          .eq('id', data.eventId)
          .maybeSingle<{ title: string }>()
        if (!event) throw new EventAuthzError('Podujatie sa nenašlo.')

        const { data: orders } = await db
          .from('orders')
          .select('buyer_email')
          .eq('event_id', data.eventId)
          .in('status', ['paid', 'partially_refunded'])
          .returns<{ buyer_email: string }[]>()
        const emails = [
          ...new Set(
            (orders ?? [])
              .map((o) => o.buyer_email.trim().toLowerCase())
              // POS sales may have no buyer e-mail — skip empty addresses.
              .filter((e) => e.length > 0),
          ),
        ].slice(0, MAX_RECIPIENTS)

        const { data: campaign, error: cErr } = await db
          .from('bulk_messages')
          .insert({
            event_id: data.eventId,
            subject: data.subject,
            body: data.body,
            recipient_count: emails.length,
            created_by: actorId,
          })
          .select('id')
          .maybeSingle<{ id: string }>()
        if (cErr || !campaign) {
          throw new EventAuthzError('Správu sa nepodarilo uložiť.')
        }

        if (emails.length > 0) {
          const { subject, html } = bulkMessageEmail({
            eventTitle: event.title,
            subject: data.subject,
            bodyText: data.body,
          })
          await db.from('email_jobs').upsert(
            bulkJobRows({
              campaignId: campaign.id,
              eventId: data.eventId,
              emails,
              subject,
              html,
            }),
            { onConflict: 'dedup_key', ignoreDuplicates: true },
          )
        }

        return { ok: true as const, recipientCount: emails.length }
      })
    },
  )

export interface BulkMessageLog {
  id: string
  subject: string
  body: string
  recipientCount: number
  createdAt: string
  sent: number
  failed: number
  pending: number
}

export const listBulkMessagesFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<BulkMessageLog[] | { error: string }> => {
    return run(async () => {
      await requireEventManager(data.eventId)
      const db = serviceClient()

      const { data: msgs } = await db
        .from('bulk_messages')
        .select('id, subject, body, recipient_count, created_at')
        .eq('event_id', data.eventId)
        .order('created_at', { ascending: false })
        .returns<
          {
            id: string
            subject: string
            body: string
            recipient_count: number
            created_at: string
          }[]
        >()
      const campaigns = msgs ?? []
      if (campaigns.length === 0) return []

      const { data: jobs } = await db
        .from('email_jobs')
        .select('campaign_id, status')
        .in(
          'campaign_id',
          campaigns.map((c) => c.id),
        )
        .returns<{ campaign_id: string; status: string }[]>()

      const counts = new Map<
        string,
        { sent: number; failed: number; pending: number }
      >()
      for (const j of jobs ?? []) {
        const c = counts.get(j.campaign_id) ?? {
          sent: 0,
          failed: 0,
          pending: 0,
        }
        if (j.status === 'sent') c.sent++
        else if (j.status === 'failed') c.failed++
        else c.pending++ // pending | sending
        counts.set(j.campaign_id, c)
      }

      return campaigns.map((m) => {
        const c = counts.get(m.id) ?? { sent: 0, failed: 0, pending: 0 }
        return {
          id: m.id,
          subject: m.subject,
          body: m.body,
          recipientCount: m.recipient_count,
          createdAt: m.created_at,
          sent: c.sent,
          failed: c.failed,
          pending: c.pending,
        }
      })
    })
  })
