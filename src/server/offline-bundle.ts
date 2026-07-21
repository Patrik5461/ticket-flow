/**
 * Offline bundle for the native Ticketio Scan app — the ticket list a device
 * needs to validate scans with no network.
 *
 * SECURITY — the bundle deliberately does NOT contain the event's `qr_secret`.
 * Whoever holds that secret can mint valid QR codes for the event, and the app
 * runs on door staff phones (possibly borrowed hardware). Instead each ticket
 * ships as `tokenHash` = SHA-256 of its complete QR token. The device hashes
 * whatever it scans and looks the digest up: forgery still fails (you cannot
 * produce a token that hashes into the list without already having the token),
 * but nothing extractable from the device can be turned into a ticket.
 *
 * The trade-off is that a ticket sold AFTER the last download is unknown to the
 * device — the app reports it as "unknown, verify online", never as invalid.
 *
 * Paginated so the app can show download progress on large events.
 *
 * Server-only.
 */

import * as nodeCrypto from 'node:crypto'
import { serviceClient } from '../lib/supabase/server'
import { signTicket } from '../lib/qr'

export interface OfflineTicket {
  id: string
  /** SHA-256 (hex) of the full QR token `TIK.{id}.{sig}`. */
  tokenHash: string
  holderName: string | null
  ticketType: string | null
  seat: string | null
  status: 'valid' | 'used' | 'cancelled'
  usedAt: string | null
  /** Admissions so far ('ok' + 're-entry'), for offline re-entry numbering. */
  entryCount: number
}

export interface OfflineEventMeta {
  id: string
  title: string
  startsAt: string
  endsAt: string | null
  timezone: string
  venueName: string | null
  /** Phase 23 re-entry mode — offline scans must honour it too. */
  allowReentry: boolean
}

export interface OfflineBundlePage {
  event: OfflineEventMeta
  generatedAt: string
  /** Total tickets for the event (all pages). */
  total: number
  offset: number
  limit: number
  tickets: OfflineTicket[]
}

/** Structural subset of the Supabase client used here (fakes in tests). */
export interface OfflineDb {
  from: (table: string) => any
}

interface EventRecord {
  id: string
  title: string
  starts_at: string
  ends_at: string | null
  timezone: string
  venue_name: string | null
  allow_reentry: boolean
  qr_secret: string
}

type SeatEmbed =
  | { sector: string; row_label: string; seat_number: string }
  | { sector: string; row_label: string; seat_number: string }[]
  | null

interface TicketRecord {
  id: string
  status: 'valid' | 'used' | 'cancelled'
  used_at: string | null
  holder_name: string | null
  ticket_types: { name: string } | { name: string }[] | null
  seats?: SeatEmbed
}

function seatLabel(row: TicketRecord): string | null {
  const embed = row.seats
  const s = Array.isArray(embed) ? embed[0] : embed
  return s ? `${s.sector} · rad ${s.row_label} · miesto ${s.seat_number}` : null
}

function typeName(row: TicketRecord): string | null {
  const t = row.ticket_types
  if (!t) return null
  return Array.isArray(t) ? (t[0]?.name ?? null) : t.name
}

export function sha256Hex(input: string): string {
  return nodeCrypto.createHash('sha256').update(input).digest('hex')
}

/**
 * One page of the offline bundle for `eventId`. Returns null when the event does
 * not belong to `organizerId` (the caller maps that to 403) — the same ownership
 * predicate the check-in path uses.
 */
export async function loadOfflineBundle(args: {
  eventId: string
  organizerId: string
  offset: number
  limit: number
  now?: () => string
  db?: OfflineDb
}): Promise<OfflineBundlePage | null> {
  const db = args.db ?? serviceClient()
  const nowIso = args.now ?? (() => new Date().toISOString())

  const { data: event } = (await db
    .from('events')
    .select(
      'id, title, starts_at, ends_at, timezone, venue_name, allow_reentry, qr_secret',
    )
    .eq('id', args.eventId)
    .eq('organizer_id', args.organizerId)
    .maybeSingle()) as { data: EventRecord | null }
  if (!event) return null

  const { count } = (await db
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', args.eventId)) as { count: number | null }

  // Ordered by id so paging is stable across requests.
  const { data: rows } = (await db
    .from('tickets')
    .select(
      'id, status, used_at, holder_name, ticket_types(name), seats(sector, row_label, seat_number)',
    )
    .eq('event_id', args.eventId)
    .order('id', { ascending: true })
    .range(args.offset, args.offset + args.limit - 1)) as {
    data: TicketRecord[] | null
  }
  const tickets = rows ?? []

  // Admission counts for this page only.
  const ids = tickets.map((t) => t.id)
  const entryCounts = new Map<string, number>()
  if (ids.length) {
    const { data: entries } = (await db
      .from('checkin_log')
      .select('ticket_id')
      .in('ticket_id', ids)
      .in('result', ['ok', 'reentry'])) as {
      data: { ticket_id: string }[] | null
    }
    for (const e of entries ?? []) {
      entryCounts.set(e.ticket_id, (entryCounts.get(e.ticket_id) ?? 0) + 1)
    }
  }

  return {
    event: {
      id: event.id,
      title: event.title,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      timezone: event.timezone,
      venueName: event.venue_name,
      allowReentry: event.allow_reentry,
    },
    generatedAt: nowIso(),
    total: count ?? tickets.length,
    offset: args.offset,
    limit: args.limit,
    tickets: tickets.map((t) => ({
      id: t.id,
      // The secret never leaves the server — only the digest of the token.
      tokenHash: sha256Hex(signTicket(t.id, event.qr_secret)),
      holderName: t.holder_name,
      ticketType: typeName(t),
      seat: seatLabel(t),
      status: t.status,
      usedAt: t.used_at,
      entryCount: entryCounts.get(t.id) ?? 0,
    })),
  }
}
