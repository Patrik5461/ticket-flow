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
import { IMPERSONATE_COOKIE } from '../impersonation-cookie'

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
          value: c.value,
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

/**
 * Extract a generic Bearer token from an Authorization header (any scheme,
 * unlike `bearerToken` in api-keys.ts which is tik_-prefix-only). Pure.
 */
export function parseBearer(header: string | null): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!m) return null
  return m[1].trim() || null
}

/** Validate a Supabase access token (JWT) and return the user id, or null. */
async function verifySupabaseToken(token: string): Promise<string | null> {
  const env = getEnv()
  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: () => {} },
  })
  // getUser(jwt) validates the token against the Auth server; expired or
  // tampered tokens (and non-JWTs like tik_ API keys) come back as an error.
  const { data, error } = await supabase.auth.getUser(token)
  if (error) return null
  return data.user.id
}

/**
 * Like `getUserIdFromRequest`, but also accepts a Supabase access token via the
 * `Authorization: Bearer` header — used by the native Ticketio Scan app, which
 * authenticates with a token rather than a cookie. Falls back to the session
 * cookie when no Bearer is present, so the web check-in page is unchanged.
 *
 * A Bearer token is only a different TRANSPORT for the same credential: callers
 * still run the identical `organizer_members` check afterwards. Wired ONLY into
 * `/api/checkin` — never the admin / revenue / export endpoints, which stay
 * cookie-only via `getUserIdFromRequest`.
 */
export async function getUserIdFromBearerOrCookie(
  request: Request,
): Promise<string | null> {
  const token = parseBearer(request.headers.get('authorization'))
  if (token) return verifySupabaseToken(token)
  return getUserIdFromRequest(request)
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

/**
 * The organizer whose data this request should see — the SAME resolution the
 * server-fn layer does in requireOrganizer(), including impersonation.
 *
 * A platform admin viewing an organizer read-only must get identical behaviour
 * everywhere; without this the SSE stream would fall back to polling only for
 * them and "Naživo" would mysteriously not light up. Impersonation is honored
 * only for a verified platform admin, so a forged cookie from anyone else is
 * ignored — the same rule as server/impersonation-session.ts.
 */
export async function organizerIdForRequest(
  request: Request,
  userId: string,
): Promise<string | null> {
  const impersonated = readCookie(request, IMPERSONATE_COOKIE)
  if (impersonated && (await isPlatformAdminUser(userId))) {
    const { data } = await serviceClient()
      .from('organizers')
      .select('id')
      .eq('id', impersonated)
      .maybeSingle<{ id: string }>()
    if (data) return data.id
  }
  return organizerIdForUser(userId)
}

/** Read one cookie off a Request (route handlers have no getRequest context). */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return null
}
