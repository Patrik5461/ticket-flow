/**
 * Guestlist: import contacts and issue free comp tickets (no order), then email
 * each ticket via the email queue ('ticket' job). Authorized for an owner/admin of
 * the event's organizer (or a platform admin).
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requireEventManager, EventAuthzError } from './event-authz'
import { parseGuestlist } from '../lib/guestlist'
import type { Guest } from '../lib/guestlist'
import type { TicketStatus } from '../lib/db-types'

async function run<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof EventAuthzError) return { error: e.message }
    throw e
  }
}

export interface GuestlistImportResult {
  created: number
  skipped: number // dropped while parsing (invalid/duplicate)
  capacityShort: number // guests that didn't fit the ticket type's capacity
}

/** Issue one comp ticket per guest (capacity-reserved) and enqueue its email. */
async function generateGuestlistTickets(
  eventId: string,
  ticketTypeId: string,
  guests: Guest[],
): Promise<{ created: number; capacityShort: number }> {
  const db = serviceClient()
  let created = 0
  let capacityShort = 0

  for (const g of guests) {
    const { data: ok } = await db.rpc('reserve_ticket_capacity', {
      p_ticket_type_id: ticketTypeId,
      p_qty: 1,
    })
    if (!ok) {
      capacityShort++
      continue
    }

    const { data: ticket } = await db
      .from('tickets')
      .insert({
        order_id: null,
        ticket_type_id: ticketTypeId,
        event_id: eventId,
        holder_name: g.name,
        holder_email: g.email,
        status: 'valid',
        source: 'guestlist',
      })
      .select('id')
      .maybeSingle<{ id: string }>()
    if (!ticket) {
      await db
        .rpc('release_ticket_capacity', {
          p_ticket_type_id: ticketTypeId,
          p_qty: 1,
        })
        .then(
          () => undefined,
          () => undefined,
        )
      continue
    }

    created++
    await db.from('email_jobs').insert({
      kind: 'ticket',
      recipient: g.email,
      event_id: eventId,
      ticket_id: ticket.id,
      dedup_key: `ticket:${ticket.id}`,
    })
  }

  return { created, capacityShort }
}

export const importGuestlistFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        ticketTypeId: z.string().uuid(),
        csv: z.string().min(1).max(1_000_000),
      })
      .parse(d),
  )
  .handler(
    async ({ data }): Promise<GuestlistImportResult | { error: string }> => {
      return run(async () => {
        await requireEventManager(data.eventId)
        const db = serviceClient()

        // The ticket type must belong to this event.
        const { data: tt } = await db
          .from('ticket_types')
          .select('id')
          .eq('id', data.ticketTypeId)
          .eq('event_id', data.eventId)
          .maybeSingle<{ id: string }>()
        if (!tt) throw new EventAuthzError('Neplatný typ vstupenky.')

        const { guests, skipped } = parseGuestlist(data.csv)
        const { created, capacityShort } = await generateGuestlistTickets(
          data.eventId,
          data.ticketTypeId,
          guests,
        )
        return { created, skipped, capacityShort }
      })
    },
  )

export interface GuestRow {
  id: string
  ref: string
  holderName: string | null
  holderEmail: string | null
  typeName: string
  status: TicketStatus
  usedAt: string | null
}

export const getGuestlistFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<GuestRow[] | { error: string }> => {
    return run(async () => {
      await requireEventManager(data.eventId)
      const { data: rows } = await serviceClient()
        .from('tickets')
        .select(
          'id, holder_name, holder_email, status, used_at, ticket_types(name)',
        )
        .eq('event_id', data.eventId)
        .eq('source', 'guestlist')
        .order('created_at', { ascending: true })
        .returns<
          {
            id: string
            holder_name: string | null
            holder_email: string | null
            status: TicketStatus
            used_at: string | null
            ticket_types: { name: string } | null
          }[]
        >()
      return (rows ?? []).map((t) => ({
        id: t.id,
        ref: t.id.slice(0, 8).toUpperCase(),
        holderName: t.holder_name,
        holderEmail: t.holder_email,
        typeName: t.ticket_types?.name ?? '—',
        status: t.status,
        usedAt: t.used_at,
      }))
    })
  })
