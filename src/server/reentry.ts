/**
 * Re-entry / manual check-in management. Server-fn module — the handlers'
 * requireEventManager (getCurrentUser) import is stripped from the client bundle
 * by the createServerFn bridge.
 *
 * `undoCheckinFn` reverts a used ticket back to valid. It is an exceptional,
 * owner/admin-only action (NOT the `checkin` role): a door worker must never be
 * able to un-check-in a ticket themselves, or they could hand a used ticket back
 * for a second entry. Every undo is written to checkin_log with the actor's id.
 *
 * Server-only.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { serviceClient } from '../lib/supabase/server'
import { requireEventManager, EventAuthzError } from './event-authz'
import { undoLimiter } from './rate-guards'

export type UndoResult = { ok: true } | { ok: false; error: string }

export const undoCheckinFn = createServerFn({ method: 'POST' })
  .validator((d: unknown) =>
    z
      .object({ ticketId: z.string().uuid(), eventId: z.string().uuid() })
      .parse(d),
  )
  .handler(async ({ data }): Promise<UndoResult> => {
    // Authorize FIRST — owner/admin of the event's organizer (or platform
    // admin); the `checkin` role and read-only impersonation are refused.
    let userId: string
    try {
      userId = await requireEventManager(data.eventId)
    } catch (e) {
      return {
        ok: false,
        error: e instanceof EventAuthzError ? e.message : 'Chyba.',
      }
    }

    if (!undoLimiter.check(userId).ok) {
      return { ok: false, error: 'Príliš veľa pokusov. Skúste o chvíľu.' }
    }

    const db = serviceClient()

    // Revert used -> valid, only for a ticket that belongs to this event and is
    // currently used. The status predicate makes it safe and idempotent (a
    // second undo, or an already-valid ticket, changes nothing).
    const { data: reverted } = (await db
      .from('tickets')
      .update({ status: 'valid', used_at: null, checked_in_by: null })
      .eq('id', data.ticketId)
      .eq('event_id', data.eventId)
      .eq('status', 'used')
      .select('id')
      .maybeSingle()) as { data: { id: string } | null }

    if (!reverted) {
      return { ok: false, error: 'Vstupenka nie je označená ako použitá.' }
    }

    // Audit trail — history stays complete (the original 'ok'/'reentry' rows
    // remain; this records who reverted it and when).
    await db.from('checkin_log').insert({
      ticket_id: data.ticketId,
      event_id: data.eventId,
      result: 'undo',
      device_label: null,
      performed_by: userId,
    })

    return { ok: true }
  })
