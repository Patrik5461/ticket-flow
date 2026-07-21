import { supabase } from './supabase'
import { withTimeout } from './net'
import { getOfflineBundle, listOffline } from './offline'
import type { EventRow } from './types'

/**
 * The event list, from the server when possible and from the downloaded
 * bundles when not.
 *
 * Offline this screen used to hang forever: the Supabase request never settles
 * in airplane mode, so coming back from the scanner left a permanent spinner.
 * Now every server read has a deadline and falls back to local data.
 */

/** A server read may not hold the screen longer than this. */
export const SERVER_TIMEOUT_MS = 5000

export type EventsSource = 'server' | 'offline'

export interface EventsResult {
  events: EventRow[]
  /** Which data the list came from — the UI labels the offline case. */
  source: EventsSource
}

interface EventRecord {
  id: string
  title: string
  starts_at: string
  timezone: string
  venue_name: string | null
}

/** Count tickets for an event with the given statuses (RLS-scoped). */
async function ticketCount(eventId: string, statuses: string[]): Promise<number> {
  const { count } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .in('status', statuses)
  return count ?? 0
}

/**
 * Events the signed-in member can access, with check-in progress. Pure
 * client-side over Supabase RLS (events_member_read / tickets_member_read) —
 * no server endpoint. Any organizer role (owner / admin / checkin) is allowed.
 */
async function loadFromServer(): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('events')
    .select('id, title, starts_at, timezone, venue_name')
    .order('starts_at', { ascending: false })
  if (error) throw error

  const events = (data ?? []) as EventRecord[]
  return Promise.all(
    events.map(async (e) => {
      const [total, checkedIn] = await Promise.all([
        ticketCount(e.id, ['valid', 'used']),
        ticketCount(e.id, ['used']),
      ])
      return {
        id: e.id,
        title: e.title,
        startsAt: e.starts_at,
        timezone: e.timezone,
        venueName: e.venue_name,
        total,
        checkedIn,
      }
    }),
  )
}

/**
 * Events built from downloaded bundles. Only events with local data appear —
 * without a bundle the scanner could not do anything with them anyway.
 *
 * The counters come from the local ticket states, so they include admissions
 * made offline and the operator sees the door's real progress.
 */
export async function loadOfflineEvents(): Promise<EventRow[]> {
  const index = await listOffline()
  const rows = await Promise.all(
    Object.values(index).map(async (meta) => {
      const bundle = await getOfflineBundle(meta.eventId)
      const tickets = bundle ? Object.values(bundle.byHash) : []
      return {
        id: meta.eventId,
        title: meta.title,
        startsAt: meta.startsAt,
        timezone: meta.timezone,
        venueName: meta.venueName,
        total: tickets.filter((t) => t.status !== 'cancelled').length,
        checkedIn: tickets.filter((t) => t.status === 'used').length,
        offline: true,
        syncedAt: meta.syncedAt,
      }
    }),
  )
  return rows.sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1))
}

/**
 * The list for the screen: server data when the network answers in time,
 * otherwise the downloaded bundles. Never rejects for connectivity reasons —
 * the worst case is an empty offline list.
 */
export async function loadEvents(
  timeoutMs = SERVER_TIMEOUT_MS,
): Promise<EventsResult> {
  if (navigator.onLine) {
    try {
      const events = await withTimeout(
        loadFromServer(),
        timeoutMs,
        'zoznam podujatí',
      )
      return { events, source: 'server' }
    } catch {
      // Timed out, offline despite navigator.onLine, or Supabase refused —
      // local data is better than an empty screen.
    }
  }
  return { events: await loadOfflineEvents(), source: 'offline' }
}
