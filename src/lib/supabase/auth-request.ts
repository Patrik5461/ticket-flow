/**
 * Request-based auth resolution for server ROUTE handlers (e.g. CSV export).
 *
 * Unlike auth.ts, this does NOT import `@tanstack/react-start/server` (getCookie/
 * setCookie/getRequest). That module is client-protected, and route files ship to
 * the client route tree — importing it (transitively) from a route breaks the
 * build. Here we read cookies straight off the passed Request, so a route handler
 * can authenticate without pulling protected imports into the client graph.
 *
 * Server-only.
 */

import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { getEnv } from '../env'
import { serviceClient } from './server'

/** Validate the session cookie on `request` and return the user id, or null. */
export async function getUserIdFromRequest(
  request: Request,
): Promise<string | null> {
  const env = getEnv()
  const cookieHeader = request.headers.get('cookie') ?? ''
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(cookieHeader).map((c) => ({
          name: c.name,
          value: c.value ?? '',
        }))
      },
      setAll() {
        /* read-only: route handlers here never refresh the session */
      },
    },
  })
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/** The organizer id the user belongs to, or null. */
export async function organizerIdForUser(
  userId: string,
): Promise<string | null> {
  const { data } = await serviceClient()
    .from('organizer_members')
    .select('organizer_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle<{ organizer_id: string }>()
  return data?.organizer_id ?? null
}

/** Whether the user is a platform super-admin. For route handlers (no admin.ts
 *  import, which would pull protected getCurrentUser into the client graph). */
export async function isPlatformAdminUser(userId: string): Promise<boolean> {
  const { data } = await serviceClient()
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle<{ user_id: string }>()
  return Boolean(data)
}
