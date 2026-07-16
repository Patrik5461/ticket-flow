/**
 * Real dependencies for the email-queue worker. Renders each job by kind and
 * sends via the configured provider. Free of admin.ts / getCurrentUser so the
 * /api/cron/process-email route can import it.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { getEmailProvider } from '../lib/email'
import { reminderEmail } from '../lib/email/templates'
import { signOrderToken } from '../lib/order-token'
import { getEnv } from '../lib/env'
import type { EmailJobsDeps, EmailJobRow } from './email-jobs'

function fmtDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: tz,
  }).format(new Date(iso))
}

async function sendReminder(job: EmailJobRow): Promise<void> {
  if (!job.order_id) return
  const db = serviceClient()

  const { data: order } = await db
    .from('orders')
    .select('id, buyer_email, event_id')
    .eq('id', job.order_id)
    .maybeSingle<{ id: string; buyer_email: string; event_id: string }>()
  if (!order) return // order gone — nothing to send

  const { data: event } = await db
    .from('events')
    .select('title, starts_at, timezone, venue_name, qr_secret')
    .eq('id', order.event_id)
    .maybeSingle<{
      title: string
      starts_at: string
      timezone: string
      venue_name: string | null
      qr_secret: string
    }>()
  if (!event) return

  const token = signOrderToken(order.id, event.qr_secret)
  const orderUrl = `${getEnv().APP_URL}/order/${order.id}?t=${encodeURIComponent(token)}`
  const { subject, html } = reminderEmail({
    eventTitle: event.title,
    whenLabel: fmtDateTime(event.starts_at, event.timezone),
    venue: event.venue_name,
    orderUrl,
  })
  await getEmailProvider().send({ to: job.recipient, subject, html })
}

async function sendBulk(job: EmailJobRow): Promise<void> {
  if (!job.subject || !job.html) {
    throw new Error('bulk job missing subject/html')
  }
  await getEmailProvider().send({
    to: job.recipient,
    subject: job.subject,
    html: job.html,
  })
}

export function realEmailJobsDeps(): EmailJobsDeps {
  return {
    db: serviceClient(),
    sendJob: async (job) => {
      switch (job.kind) {
        case 'reminder':
          await sendReminder(job)
          return
        case 'bulk':
          await sendBulk(job)
          return
        default:
          throw new Error(`Neznámy typ e-mailu: ${job.kind}`)
      }
    },
    now: () => new Date().toISOString(),
  }
}
