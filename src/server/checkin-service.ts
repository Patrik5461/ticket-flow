/**
 * Check-in domain logic. Pure server module — imports only the service client, the
 * QR verifier and types (no cookie/auth imports, no client components import it),
 * so both the POST /api/checkin route and the dashboard board fn can use it without
 * pulling protected server-only modules into the client bundle.
 *
 * The scan is idempotent: the mark-as-used step is a single conditional UPDATE
 * (status must still be 'valid'), so two devices racing on the same ticket cannot
 * both win — the loser re-reads the authoritative first-use time and reports
 * `already_used`. A scan never throws for the caller: unknown/forged codes resolve
 * to `invalid`, and every attempt is written to checkin_log.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { verifyTicket } from '../lib/qr'

/** Mirrors the checkin_log.result enum. */
export type CheckinOutcome = 'ok' | 'already_used' | 'cancelled' | 'invalid'

export interface CheckinResponse {
  result: CheckinOutcome
  /** Ticket holder name, when the code resolved to a real ticket. */
  holderName: string | null
  /** Ticket type name, when known. */
  ticketType: string | null
  /**
   * For `ok`: the moment we just admitted the holder. For `already_used`: the
   * authoritative time of the FIRST admission. Null otherwise.
   */
  usedAt: string | null
  /** Short human-facing ticket reference (first 8 of the id), when known. */
  ref: string | null
}

export interface CheckinSummary {
  total: number
  checkedIn: number
}

/**
 * Minimal structural type for the pieces of the Supabase client this module uses.
 * Kept local so tests can inject an in-memory fake without depending on the full
 * client type.
 */
export interface CheckinDb {
  from: (table: string) => any
}

function invalidResponse(): CheckinResponse {
  return {
    result: 'invalid',
    holderName: null,
    ticketType: null,
    usedAt: null,
    ref: null,
  }
}

interface TicketRow {
  id: string
  status: 'valid' | 'used' | 'cancelled'
  used_at: string | null
  holder_name: string | null
  event_id: string
  ticket_types: { name: string } | { name: string }[] | null
}

function typeName(row: TicketRow): string | null {
  const t = row.ticket_types
  if (!t) return null
  return Array.isArray(t) ? (t[0]?.name ?? null) : t.name
}

/**
 * Process one scanned QR string for `eventId`, on behalf of member `userId` of
 * `organizerId`. Returns null when the event does not belong to that organizer
 * (the caller maps this to 403); otherwise always returns a CheckinResponse.
 */
export async function checkInTicket(args: {
  eventId: string
  organizerId: string
  qr: string
  userId: string
  deviceLabel?: string | null
  now?: () => string
  db?: CheckinDb
}): Promise<CheckinResponse | null> {
  const db = args.db ?? serviceClient()
  const nowIso = args.now ?? (() => new Date().toISOString())
  const deviceLabel = args.deviceLabel ?? null

  // 1. Authorize + fetch the event secret in one query: the event must belong to
  //    the caller's organizer. verifyTicket below is keyed by this secret, so a
  //    code signed for any other event cannot validate here.
  const { data: event } = await db
    .from('events')
    .select('id, qr_secret')
    .eq('id', args.eventId)
    .eq('organizer_id', args.organizerId)
    .maybeSingle()
  if (!event) return null

  const log = (ticketId: string | null, result: CheckinOutcome) =>
    db.from('checkin_log').insert({
      ticket_id: ticketId,
      event_id: args.eventId,
      result,
      device_label: deviceLabel,
    })

  // 2. Verify the HMAC signature against this event's secret.
  const ticketId = verifyTicket(args.qr.trim(), event.qr_secret)
  if (!ticketId) {
    await log(null, 'invalid')
    return invalidResponse()
  }

  // 3. Load the ticket. A valid signature for a missing ticket, or one belonging
  //    to a different event, is treated as invalid (defensive — should not happen).
  const { data: ticket } = (await db
    .from('tickets')
    .select('id, status, used_at, holder_name, event_id, ticket_types(name)')
    .eq('id', ticketId)
    .maybeSingle()) as { data: TicketRow | null }
  if (!ticket || ticket.event_id !== args.eventId) {
    await log(null, 'invalid')
    return invalidResponse()
  }

  const holderName = ticket.holder_name ?? null
  const ticketType = typeName(ticket)
  const ref = ticket.id.slice(0, 8).toUpperCase()

  if (ticket.status === 'cancelled') {
    await log(ticket.id, 'cancelled')
    return {
      result: 'cancelled',
      holderName,
      ticketType,
      usedAt: ticket.used_at ?? null,
      ref,
    }
  }

  // 4. Atomically claim the ticket. The `status = 'valid'` predicate is the
  //    concurrency guard: exactly one racing scan updates a row.
  const { data: claimed } = (await db
    .from('tickets')
    .update({ status: 'used', used_at: nowIso(), checked_in_by: args.userId })
    .eq('id', ticket.id)
    .eq('status', 'valid')
    .select('used_at')
    .maybeSingle()) as { data: { used_at: string } | null }

  if (claimed) {
    await log(ticket.id, 'ok')
    return {
      result: 'ok',
      holderName,
      ticketType,
      usedAt: claimed.used_at,
      ref,
    }
  }

  // We lost the race (or it was already used). Re-read the authoritative state so
  // we report the FIRST admission time, not this attempt's.
  const { data: fresh } = (await db
    .from('tickets')
    .select('status, used_at')
    .eq('id', ticket.id)
    .maybeSingle()) as {
    data: { status: string; used_at: string | null } | null
  }

  if (fresh?.status === 'cancelled') {
    await log(ticket.id, 'cancelled')
    return {
      result: 'cancelled',
      holderName,
      ticketType,
      usedAt: fresh.used_at ?? null,
      ref,
    }
  }
  await log(ticket.id, 'already_used')
  return {
    result: 'already_used',
    holderName,
    ticketType,
    usedAt: fresh?.used_at ?? ticket.used_at ?? null,
    ref,
  }
}

/**
 * Admitted / total counters for an event, scoped to the caller's organizer.
 * `total` counts every non-cancelled ticket; `checkedIn` counts those used.
 * Returns null when the event does not belong to the organizer.
 */
export async function getCheckinSummary(
  eventId: string,
  organizerId: string,
  db?: CheckinDb,
): Promise<CheckinSummary | null> {
  const database = db ?? serviceClient()

  const { data: event } = await database
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('organizer_id', organizerId)
    .maybeSingle()
  if (!event) return null

  const { data: rows } = (await database
    .from('tickets')
    .select('status')
    .eq('event_id', eventId)
    .neq('status', 'cancelled')) as { data: { status: string }[] | null }

  const list = rows ?? []
  return {
    total: list.length,
    checkedIn: list.filter((r) => r.status === 'used').length,
  }
}
