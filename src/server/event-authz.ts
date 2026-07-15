/**
 * Shared authorization for event-scoped management actions (cancel, refund):
 * a platform admin, or an owner/admin member of the event's organizer. Plain
 * helper — imported only by server-fn modules and used inside their handlers, so
 * its getCurrentUser import is stripped from the client bundle.
 *
 * Server-only.
 */

import { getCurrentUser } from '../lib/supabase/auth'
import { serviceClient } from '../lib/supabase/server'

export class EventAuthzError extends Error {}

/** Authorize the caller to manage `eventId`; returns the actor's user id. */
export async function requireEventManager(eventId: string): Promise<string> {
  const user = await getCurrentUser()
  if (!user) throw new EventAuthzError('Neprihlásený.')
  const db = serviceClient()

  const { data: admin } = await db
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle<{ user_id: string }>()
  if (admin) return user.id

  const { data: ev } = await db
    .from('events')
    .select('organizer_id')
    .eq('id', eventId)
    .maybeSingle<{ organizer_id: string }>()
  if (!ev) throw new EventAuthzError('Podujatie sa nenašlo.')

  const { data: mem } = await db
    .from('organizer_members')
    .select('role')
    .eq('organizer_id', ev.organizer_id)
    .eq('user_id', user.id)
    .maybeSingle<{ role: string }>()
  if (mem && (mem.role === 'owner' || mem.role === 'admin')) return user.id

  throw new EventAuthzError('Na túto akciu nemáte oprávnenie.')
}
