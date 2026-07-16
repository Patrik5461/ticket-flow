/**
 * Signed order-access tokens. A buyer reaches their order/tickets page via
 * /order/{id}?t={token} without authentication. The token is an HMAC over the
 * order id keyed by the event's qr_secret — no separate app secret required, and
 * a token is only valid for its own order.
 */

// Namespace import (see webhooks.ts for the same pattern) so Vite's client-side
// stub for `node:crypto` doesn't throw at module load.
import * as nodeCrypto from 'node:crypto'

const SIG_BYTES = 16

export function signOrderToken(orderId: string, eventSecret: string): string {
  return nodeCrypto.createHmac('sha256', eventSecret)
    .update(`order:${orderId}`)
    .digest()
    .subarray(0, SIG_BYTES)
    .toString('base64url')
}

export function verifyOrderToken(
  orderId: string,
  token: string,
  eventSecret: string,
): boolean {
  const expected = signOrderToken(orderId, eventSecret)
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return nodeCrypto.timingSafeEqual(a, b)
}
