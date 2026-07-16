/**
 * Render + send a single ticket email (QR + PDF) to a recipient. Shared by the
 * email-queue 'ticket' worker and the organizer's ticket actions (re-send,
 * transfer). Skips cancelled tickets.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { getEmailProvider } from '../lib/email'
import { ticketsEmail, ticketBlockHtml } from '../lib/email/templates'
import { signTicket } from '../lib/qr'
import { renderTicketPdf } from '../lib/tickets/pdf'
import { qrDataUrl } from '../lib/tickets/qr-image'

function fmtDateTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: tz,
  }).format(new Date(iso))
}

export async function sendSingleTicketEmail(
  ticketId: string,
  recipient: string,
): Promise<void> {
  const db = serviceClient()

  const { data: ticket } = await db
    .from('tickets')
    .select('id, ticket_type_id, event_id, holder_name, status')
    .eq('id', ticketId)
    .maybeSingle<{
      id: string
      ticket_type_id: string
      event_id: string
      holder_name: string | null
      status: string
    }>()
  if (!ticket || ticket.status === 'cancelled') return

  const { data: event } = await db
    .from('events')
    .select('title, venue_name, starts_at, timezone, qr_secret')
    .eq('id', ticket.event_id)
    .maybeSingle<{
      title: string
      venue_name: string | null
      starts_at: string
      timezone: string
      qr_secret: string
    }>()
  if (!event) return

  const { data: tt } = await db
    .from('ticket_types')
    .select('name')
    .eq('id', ticket.ticket_type_id)
    .maybeSingle<{ name: string }>()
  const typeName = tt?.name ?? 'Vstupenka'
  const ref = ticket.id.slice(0, 8).toUpperCase()
  const whenLabel = fmtDateTime(event.starts_at, event.timezone)
  const qrToken = signTicket(ticket.id, event.qr_secret)

  const pdf = await renderTicketPdf({
    eventTitle: event.title,
    venue: event.venue_name,
    startsAtLabel: whenLabel,
    ticketTypeName: typeName,
    holderName: ticket.holder_name,
    ticketRef: ref,
    qrToken,
  })
  const { subject, html } = ticketsEmail({
    eventTitle: event.title,
    whenLabel,
    venue: event.venue_name,
    orderRef: ref,
    ticketsHtml: ticketBlockHtml(typeName, await qrDataUrl(qrToken)),
  })
  await getEmailProvider().send({
    to: recipient,
    subject,
    html,
    attachments: [
      {
        filename: `vstupenka-${ticket.id.slice(0, 8)}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      },
    ],
  })
}
