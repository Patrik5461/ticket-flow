/**
 * Per-ticket organizer actions: re-send, rename holder, cancel (invalidate, no
 * refund), and transfer to another email. Authorized for an owner/admin of the
 * event's organizer (or a platform admin). Every mutation is audited.
 *
 * Exports only server fns; handler imports are stripped from the client bundle.
 *
 * Server-only.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requireEventManager, EventAuthzError } from './event-authz'
import { writeAuditLog } from './admin'
import { sendSingleTicketEmail } from './ticket-email'

async function run<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof EventAuthzError) return { error: e.message }
    throw e
  }
}

interface TicketCtx {
  id: string
  event_id: string
  order_id: string | null
  ticket_type_id: string
  holder_email: string | null
  holder_name: string | null
  status: string
  source: string
}

async function loadTicket(ticketId: string): Promise<TicketCtx> {
  const { data } = await serviceClient()
    .from('tickets')
    .select(
      'id, event_id, order_id, ticket_type_id, holder_email, holder_name, status, source',
    )
    .eq('id', ticketId)
    .maybeSingle<TicketCtx>()
  if (!data) throw new EventAuthzError('Vstupenka sa nenašla.')
  return data
}

/** The address a ticket email goes to: the ticket's own email, else its order's. */
async function recipientOf(ticket: TicketCtx): Promise<string | null> {
  if (ticket.holder_email) return ticket.holder_email
  if (ticket.order_id) {
    const { data } = await serviceClient()
      .from('orders')
      .select('buyer_email')
      .eq('id', ticket.order_id)
      .maybeSingle<{ buyer_email: string }>()
    return data?.buyer_email ?? null
  }
  return null
}

export const resendTicketFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ ticketId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return run(async () => {
      const ticket = await loadTicket(data.ticketId)
      await requireEventManager(ticket.event_id)
      if (ticket.status === 'cancelled') {
        throw new EventAuthzError('Zrušenú vstupenku nie je možné poslať.')
      }
      const to = await recipientOf(ticket)
      if (!to) throw new EventAuthzError('Chýba e-mailová adresa príjemcu.')
      await sendSingleTicketEmail(ticket.id, to)
      return { ok: true as const }
    })
  })

export const updateTicketHolderFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        ticketId: z.string().uuid(),
        holderName: z.string().trim().max(120).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return run(async () => {
      const ticket = await loadTicket(data.ticketId)
      const actorId = await requireEventManager(ticket.event_id)
      const holderName = data.holderName?.trim() || null
      const { error } = await serviceClient()
        .from('tickets')
        .update({ holder_name: holderName })
        .eq('id', ticket.id)
      if (error) throw new EventAuthzError('Meno sa nepodarilo uložiť.')
      await writeAuditLog({
        actorId,
        action: 'ticket.rename',
        entityType: 'ticket',
        entityId: ticket.id,
        oldValue: { holder_name: ticket.holder_name },
        newValue: { holder_name: holderName },
      })
      return { ok: true as const }
    })
  })

/** Invalidate a single ticket (no refund) and free its capacity. */
export const cancelTicketFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ ticketId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return run(async () => {
      const ticket = await loadTicket(data.ticketId)
      const actorId = await requireEventManager(ticket.event_id)
      if (ticket.status === 'cancelled') return { ok: true as const }

      const db = serviceClient()
      const { error } = await db
        .from('tickets')
        .update({ status: 'cancelled' })
        .eq('id', ticket.id)
      if (error) throw new EventAuthzError('Vstupenku sa nepodarilo zrušiť.')
      await db
        .rpc('release_ticket_capacity', {
          p_ticket_type_id: ticket.ticket_type_id,
          p_qty: 1,
        })
        .then(
          () => undefined,
          () => undefined,
        )
      await writeAuditLog({
        actorId,
        action: 'ticket.cancel',
        entityType: 'ticket',
        entityId: ticket.id,
        oldValue: { status: ticket.status },
        newValue: { status: 'cancelled' },
      })
      return { ok: true as const }
    })
  })

/**
 * Re-generate a ticket's QR on suspected leak/loss: issue a fresh ticket (new id
 * → new QR) for the same seat and cancel the old one, so any copy of the old QR is
 * rejected at check-in. Capacity is unchanged (the new ticket keeps the old seat),
 * so no reserve/release. The new ticket is re-sent to the recipient.
 */
export const regenerateTicketFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ ticketId: z.string().uuid() }).parse(d))
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; newTicketId: string } | { error: string }> => {
      return run(async () => {
        const ticket = await loadTicket(data.ticketId)
        const actorId = await requireEventManager(ticket.event_id)
        if (ticket.status === 'cancelled') {
          throw new EventAuthzError(
            'Zrušenú vstupenku nie je možné re-generovať.',
          )
        }

        const db = serviceClient()
        // New ticket for the same seat — do NOT touch capacity.
        const { data: created } = await db
          .from('tickets')
          .insert({
            order_id: ticket.order_id,
            ticket_type_id: ticket.ticket_type_id,
            event_id: ticket.event_id,
            holder_name: ticket.holder_name,
            holder_email: ticket.holder_email,
            status: 'valid',
            source: ticket.source,
          })
          .select('id')
          .maybeSingle<{ id: string }>()
        if (!created) {
          throw new EventAuthzError('Novú vstupenku sa nepodarilo vytvoriť.')
        }

        // Invalidate the old QR (no capacity release — the new one holds the seat).
        await db
          .from('tickets')
          .update({ status: 'cancelled' })
          .eq('id', ticket.id)

        await writeAuditLog({
          actorId,
          action: 'ticket.regenerate',
          entityType: 'ticket',
          entityId: ticket.id,
          oldValue: { ticket_id: ticket.id },
          newValue: { ticket_id: created.id },
        })

        const to = await recipientOf(ticket)
        if (to) await sendSingleTicketEmail(created.id, to)
        return { ok: true as const, newTicketId: created.id }
      })
    },
  )

/** Reassign a ticket to another email and re-send it there. */
export const transferTicketFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({
        ticketId: z.string().uuid(),
        email: z.string().email(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true } | { error: string }> => {
    return run(async () => {
      const ticket = await loadTicket(data.ticketId)
      const actorId = await requireEventManager(ticket.event_id)
      if (ticket.status === 'cancelled') {
        throw new EventAuthzError('Zrušenú vstupenku nie je možné presunúť.')
      }
      const email = data.email.trim().toLowerCase()
      const { error } = await serviceClient()
        .from('tickets')
        .update({ holder_email: email })
        .eq('id', ticket.id)
      if (error) throw new EventAuthzError('Presun sa nepodaril.')

      await writeAuditLog({
        actorId,
        action: 'ticket.transfer',
        entityType: 'ticket',
        entityId: ticket.id,
        oldValue: { holder_email: ticket.holder_email },
        newValue: { holder_email: email },
      })
      await sendSingleTicketEmail(ticket.id, email)
      return { ok: true as const }
    })
  })
