/**
 * Impersonation session resolution — plain server helpers. Imported ONLY by other
 * server modules (dashboard, event-authz, refunds, auth), never by a route file,
 * so its react-start/server import is stripped from the client bundle along with
 * the server-fn handlers that use it.
 *
 * Security: the cookie is honored only when the current user is a verified
 * platform admin, so a forged cookie from a non-admin is ignored.
 *
 * Server-only.
 */

import { getRequest } from '@tanstack/react-start/server'
import { serviceClient } from '../lib/supabase/server'
import { getCurrentUser } from '../lib/supabase/auth'
import { isPlatformAdmin } from './admin'

export const IMPERSONATE_COOKIE = 'ticketio_impersonate'

function readCookie(name: string): string | null {
  const header = getRequest().headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return null
}

export interface ImpersonationInfo {
  organizerId: string
  organizerName: string
}

/**
 * The impersonated organizer for this request, or null. Only returns a value
 * when the caller is a verified platform admin.
 */
export async function getImpersonation(
  user?: { id: string } | null,
): Promise<ImpersonationInfo | null> {
  const raw = readCookie(IMPERSONATE_COOKIE)
  if (!raw) return null
  const u = user ?? (await getCurrentUser())
  if (!u || !(await isPlatformAdmin(u.id))) return null
  const { data } = await serviceClient()
    .from('organizers')
    .select('id, name')
    .eq('id', raw)
    .maybeSingle<{ id: string; name: string }>()
  if (!data) return null
  return { organizerId: data.id, organizerName: data.name }
}

export async function isImpersonating(
  user?: { id: string } | null,
): Promise<boolean> {
  return (await getImpersonation(user)) !== null
}
