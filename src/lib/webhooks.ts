/**
 * Webhook signing + event-type helpers. Pure (node:crypto only) so both the
 * dashboard (secret generation) and the delivery worker (signing) can use them,
 * and the signature scheme is unit-testable.
 *
 * Signature: hex HMAC-SHA256 over `${timestamp}.${body}`, sent as
 *   X-Ticketio-Signature: t=<unix>,v1=<hex>
 * so receivers can verify integrity and reject stale deliveries.
 */

import { createHmac, randomBytes } from 'node:crypto'

export const WEBHOOK_EVENT_TYPES = ['order.paid', 'ticket.checked_in'] as const
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

export function isWebhookEventType(s: string): s is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(s)
}

export function generateWebhookSecret(): string {
  return 'whsec_' + randomBytes(24).toString('base64url')
}

export function signWebhookBody(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex')
}

/** Full header value: t=<timestamp>,v1=<signature>. */
export function signatureHeader(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return `t=${timestamp},v1=${signWebhookBody(secret, timestamp, body)}`
}
