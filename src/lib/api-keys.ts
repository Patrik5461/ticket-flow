/**
 * API key generation + hashing. The plaintext key is shown to the organizer once
 * at creation; the DB stores only a SHA-256 hash and a short display prefix.
 *
 * Format:  tik_live_<43 base64url chars>
 * Lookup is by hash, so verification is a single indexed equality (no per-row
 * HMAC). Keys are high-entropy (32 random bytes), so a plain hash is sufficient.
 */

import { createHash, randomBytes } from 'node:crypto'

const KEY_PREFIX = 'tik_live_'
/** Chars kept for display, e.g. "tik_live_a1b2c3d4". */
const DISPLAY_LEN = KEY_PREFIX.length + 8

export interface GeneratedApiKey {
  /** Full plaintext key — returned to the caller once, never stored. */
  key: string
  /** SHA-256 hex hash stored in the DB. */
  hash: string
  /** Short prefix stored for display. */
  prefix: string
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function keyDisplayPrefix(key: string): string {
  return key.slice(0, DISPLAY_LEN)
}

export function generateApiKey(): GeneratedApiKey {
  const key = KEY_PREFIX + randomBytes(32).toString('base64url')
  return { key, hash: hashApiKey(key), prefix: keyDisplayPrefix(key) }
}

/** Extract the bearer token from an Authorization header, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  const token = m?.[1]?.trim()
  return token && token.startsWith(KEY_PREFIX) ? token : null
}
