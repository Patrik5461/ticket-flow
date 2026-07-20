import { supabase } from './supabase'
import type { EventRow } from './types'

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
export async function loadEvents(): Promise<EventRow[]> {
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
