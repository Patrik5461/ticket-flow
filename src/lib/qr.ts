/**
 * Signed ticket QR codes.
 *
 * Token format:  TIK.{ticket_id}.{sig}
 * where sig = base64url( HMAC_SHA256(key = event.qr_secret, msg = ticket_id)[0..16] )
 *
 * Each event has its own qr_secret, so a leaked signature from one event cannot
 * forge tickets for another. The HMAC is truncated to 16 bytes to keep the QR
 * payload short while staying well beyond brute-force reach.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const PREFIX = 'TIK'
const SIG_BYTES = 16

export function signTicket(ticketId: string, eventSecret: string): string {
  const sig = createHmac('sha256', eventSecret)
    .update(ticketId)
    .digest()
    .subarray(0, SIG_BYTES)
    .toString('base64url')
  return `${PREFIX}.${ticketId}.${sig}`
}

/**
 * Verify a scanned token. Returns the ticket_id if the signature is valid for the
 * given event secret, otherwise null. Constant-time comparison.
 */
export function verifyTicket(token: string, eventSecret: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== PREFIX) return null

  const ticketId = parts[1]
  if (!ticketId) return null

  const expected = signTicket(ticketId, eventSecret)
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  return timingSafeEqual(a, b) ? ticketId : null
}
