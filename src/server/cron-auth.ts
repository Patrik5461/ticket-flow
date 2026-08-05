/**
 * The shared guard on /api/cron/*.
 *
 * All five worker endpoints had the same four lines inline, comparing the header
 * to CRON_SECRET with `!==`. That comparison returns as soon as two bytes
 * differ, so how long it takes depends on how much of the secret the caller got
 * right — the classic way to recover a secret one byte at a time. Over the
 * public internet the noise floor makes that a poor attack, but the repo already
 * compares its QR and order-token HMACs in constant time, and there is no reason
 * for this one to be the exception.
 *
 * Keeping it here rather than in the routes also means the check is defined
 * once: a route that forgets it is now visibly missing a call, not silently
 * missing four lines.
 *
 * Server-only.
 */

import nodeCrypto from 'node:crypto'
import { getEnv } from '../lib/env'

/** Constant-time string equality. Length is compared first and does leak. */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return nodeCrypto.timingSafeEqual(a, b)
}

/**
 * Authorize a cron worker request.
 *
 * Returns a 401 Response to hand straight back, or null when the caller may
 * proceed. An unset CRON_SECRET rejects everything: an empty secret would
 * otherwise open the workers to anyone once the header is left off too, and a
 * bridge that cannot authenticate should look broken rather than public.
 */
export function cronUnauthorized(request: Request): Response | null {
  const secret = getEnv().CRON_SECRET
  const provided = request.headers.get('x-cron-secret') ?? ''
  if (!secret || !secretsMatch(provided, secret)) {
    return new Response('Unauthorized', { status: 401 })
  }
  return null
}
