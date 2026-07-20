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
import { getCurrentUser } from '../lib/supabase/auth'
import { serviceClient } from '../lib/supabase/server'
import { requireEventManager, EventAuthzError } from './event-authz'
import { undoLimiter } from './rate-guards'

export type UndoResult = { ok: true } | { ok: false; error: string }

/** One check-in / undo record for a ticket. */
export interface TicketEntry {
  result: string
  at: string
  deviceLabel: string | null
}
export interface TicketCheckin {
  ticketId: string
  ref: string
  holderName: string | null
  status: 'valid' | 'used' | 'cancelled'
  usedAt: string | null
  entries: TicketEntry[]
}
export interface OrderCheckinView {
  /** Whether the caller (owner/admin/platform-admin) may undo a check-in. */
  canUndo: boolean
  tickets: TicketCheckin[]
}

interface EntryRow {
  ticket_id: string
  result: string
  created_at: string
  device_label: string | null
}
interface OrderTicketRow {
  id: string
  holder_name: string | null
  status: 'valid' | 'used' | 'cancelled'
  used_at: string | null
}

/**
 * Check-in history for one order's tickets. Any organizer member may view it;
 * `canUndo` is true only for owner/admin (or platform admin), so the UI shows
 * the undo action to them alone — the actual undo is re-authorized server-side.
 */
export const getOrderCheckinFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) =>
    z.object({ orderId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }): Promise<OrderCheckinView | { error: string }> => {
    const user = await getCurrentUser()
    if (!user) return { error: 'Neprihlásený.' }
    const db = serviceClient()

    const { data: order } = await db
      .from('orders')
      .select('id, event_id')
      .eq('id', data.orderId)
      .maybeSingle<{ id: string; event_id: string }>()
    if (!order) return { error: 'Objednávka sa nenašla.' }

    const { data: event } = await db
      .from('events')
      .select('organizer_id')
      .eq('id', order.event_id)
      .maybeSingle<{ organizer_id: string }>()
    if (!event) return { error: 'Podujatie sa nenašlo.' }

    const { data: isAdmin } = await db
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle<{ user_id: string }>()

    const { data: mem } = await db
      .from('organizer_members')
      .select('role')
      .eq('organizer_id', event.organizer_id)
      .eq('user_id', user.id)
      .maybeSingle<{ role: string }>()

    if (!isAdmin && !mem) return { error: 'Bez oprávnenia.' }
    const canUndo = Boolean(
      isAdmin || (mem && (mem.role === 'owner' || mem.role === 'admin')),
    )

    const { data: tickets } = (await db
      .from('tickets')
      .select('id, holder_name, status, used_at')
      .eq('order_id', order.id)
      .order('created_at', { ascending: true })
      .returns<OrderTicketRow[]>()) as { data: OrderTicketRow[] | null }
    const rows = tickets ?? []

    const ids = rows.map((t) => t.id)
    const { data: entries } = ids.length
      ? ((await db
          .from('checkin_log')
          .select('ticket_id, result, created_at, device_label')
          .in('ticket_id', ids)
          .order('created_at', { ascending: true })
          .returns<EntryRow[]>()) as { data: EntryRow[] | null })
      : { data: [] as EntryRow[] }
    const byTicket = new Map<string, TicketEntry[]>()
    for (const e of entries ?? []) {
      const list = byTicket.get(e.ticket_id) ?? []
      list.push({ result: e.result, at: e.created_at, deviceLabel: e.device_label })
      byTicket.set(e.ticket_id, list)
    }

    return {
      canUndo,
      tickets: rows.map((t) => ({
        ticketId: t.id,
        ref: t.id.slice(0, 8).toUpperCase(),
        holderName: t.holder_name,
        status: t.status,
        usedAt: t.used_at,
        entries: byTicket.get(t.id) ?? [],
      })),
    }
  })

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
