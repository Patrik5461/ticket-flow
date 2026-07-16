/**
 * Bearer-auth + rate limiting for the public REST API (/api/v1/*). Route-safe
 * (no getCurrentUser import). Authenticates an API key by hash lookup, applies a
 * per-key rate limit, and exposes small JSON response helpers.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { bearerToken, hashApiKey } from '../lib/api-keys'
import { RateLimiter } from '../lib/rate-limit'

export interface ApiContext {
  organizerId: string
  keyId: string
  remaining: number
  resetAt: number
}

const RATE_LIMIT = 120 // requests
const RATE_WINDOW_MS = 60_000 // per minute, per key
const limiter = new RateLimiter(RATE_LIMIT, RATE_WINDOW_MS)

export function apiError(
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

export function apiJson(
  data: unknown,
  ctx?: ApiContext,
  status = 200,
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }
  if (ctx) {
    headers['X-RateLimit-Limit'] = String(RATE_LIMIT)
    headers['X-RateLimit-Remaining'] = String(ctx.remaining)
  }
  return new Response(JSON.stringify(data), { status, headers })
}

async function authenticate(request: Request): Promise<ApiContext | Response> {
  const token = bearerToken(request.headers.get('authorization'))
  if (!token) {
    return apiError(
      401,
      'unauthorized',
      'Chýba alebo neplatný API kľúč. Použite hlavičku Authorization: Bearer <kľúč>.',
    )
  }

  const db = serviceClient()
  const { data: key } = await db
    .from('api_keys')
    .select('id, organizer_id, revoked_at')
    .eq('key_hash', hashApiKey(token))
    .maybeSingle<{
      id: string
      organizer_id: string
      revoked_at: string | null
    }>()
  if (!key || key.revoked_at) {
    return apiError(401, 'unauthorized', 'Neplatný alebo zrušený API kľúč.')
  }

  const rl = limiter.check(key.id)
  if (!rl.ok) {
    return apiError(429, 'rate_limited', 'Prekročený limit požiadaviek.', {
      'Retry-After': String(
        Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)),
      ),
      'X-RateLimit-Limit': String(RATE_LIMIT),
      'X-RateLimit-Remaining': '0',
    })
  }

  // Best-effort last-used stamp (never blocks the request).
  db.from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)
    .then(
      () => undefined,
      () => undefined,
    )

  return {
    organizerId: key.organizer_id,
    keyId: key.id,
    remaining: rl.remaining,
    resetAt: rl.resetAt,
  }
}

/** Authenticate + rate-limit, then run `fn` with the context. */
export async function withApiKey(
  request: Request,
  fn: (ctx: ApiContext) => Promise<Response>,
): Promise<Response> {
  const ctx = await authenticate(request)
  if (ctx instanceof Response) return ctx
  return fn(ctx)
}
