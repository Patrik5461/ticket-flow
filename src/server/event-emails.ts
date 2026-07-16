/**
 * Notify buyers when an event's date or venue changes. Pure diff (eventChangesHtml)
 * is unit-tested; notifyEventChanged fans the mail out best-effort to paid buyers.
 * Plain server module (no getCurrentUser) so dashboard server fns can import it.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { getEmailProvider } from '../lib/email'
import { eventChangedEmail, escapeHtml } from '../lib/email/templates'
import type { EventRow } from '../lib/db-types'

const MAX_RECIPIENTS = 2000

function fmtDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: tz,
  }).format(new Date(iso))
}

function venueLabel(name: string | null, address: string | null): string {
  return [name, address].filter(Boolean).join(', ') || '—'
}

export interface EventChangeInput {
  oldStartsAt: string
  newStartsAt: string
  oldEndsAt: string | null
  newEndsAt: string | null
  oldVenueName: string | null
  newVenueName: string | null
  oldVenueAddress: string | null
  newVenueAddress: string | null
  timezone: string
}

/**
 * Pure: the "what changed" HTML list for the email, or null if neither the
 * date/time nor the venue changed.
 */
export function eventChangesHtml(c: EventChangeInput): string | null {
  const dateChanged =
    c.oldStartsAt !== c.newStartsAt ||
    (c.oldEndsAt ?? null) !== (c.newEndsAt ?? null)
  const venueChanged =
    (c.oldVenueName ?? null) !== (c.newVenueName ?? null) ||
    (c.oldVenueAddress ?? null) !== (c.newVenueAddress ?? null)
  if (!dateChanged && !venueChanged) return null

  const items: string[] = []
  if (dateChanged) {
    items.push(
      `<li style="margin:0 0 6px">Termín: <s>${escapeHtml(fmtDateTime(c.oldStartsAt, c.timezone))}</s> → <strong>${escapeHtml(fmtDateTime(c.newStartsAt, c.timezone))}</strong></li>`,
    )
  }
  if (venueChanged) {
    items.push(
      `<li style="margin:0 0 6px">Miesto: <s>${escapeHtml(venueLabel(c.oldVenueName, c.oldVenueAddress))}</s> → <strong>${escapeHtml(venueLabel(c.newVenueName, c.newVenueAddress))}</strong></li>`,
    )
  }
  return `<ul style="margin:0 0 16px;padding-left:18px;font-size:14px">${items.join('')}</ul>`
}

/**
 * If the event's date/venue changed, email every distinct paid buyer. Best-effort:
 * individual send failures are skipped; returns how many were sent.
 */
export async function notifyEventChanged(
  event: EventRow,
  next: {
    newStartsAt: string
    newEndsAt: string | null
    newVenueName: string | null
    newVenueAddress: string | null
  },
): Promise<number> {
  const changesHtml = eventChangesHtml({
    oldStartsAt: event.starts_at,
    newStartsAt: next.newStartsAt,
    oldEndsAt: event.ends_at,
    newEndsAt: next.newEndsAt,
    oldVenueName: event.venue_name,
    newVenueName: next.newVenueName,
    oldVenueAddress: event.venue_address,
    newVenueAddress: next.newVenueAddress,
    timezone: event.timezone,
  })
  if (!changesHtml) return 0

  const { data: orders } = await serviceClient()
    .from('orders')
    .select('buyer_email')
    .eq('event_id', event.id)
    .in('status', ['paid', 'partially_refunded'])
    .returns<{ buyer_email: string }[]>()
  const emails = [
    ...new Set((orders ?? []).map((o) => o.buyer_email.toLowerCase())),
  ].slice(0, MAX_RECIPIENTS)
  if (emails.length === 0) return 0

  const whenLabel = fmtDateTime(next.newStartsAt, event.timezone)
  const venue =
    [next.newVenueName, next.newVenueAddress].filter(Boolean).join(', ') || null
  const provider = getEmailProvider()

  let sent = 0
  for (const to of emails) {
    const { subject, html } = eventChangedEmail({
      eventTitle: event.title,
      whenLabel,
      venue,
      changesHtml,
    })
    try {
      await provider.send({ to, subject, html })
      sent++
    } catch {
      /* skip a single failed recipient */
    }
  }
  return sent
}
