/**
 * Real dependencies for the webhook worker. Free of admin.ts / getCurrentUser so
 * the /api/cron/process-webhooks route can import it.
 *
 * Server-only.
 */

import { serviceClient } from '../lib/supabase/server'
import { signWebhookBody } from '../lib/webhooks'
import type { WebhookDeps } from './webhooks'

export function realWebhookDeps(): WebhookDeps {
  return {
    db: serviceClient(),
    post: async (url, body, signature) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ticketio-Signature': signature,
          'User-Agent': 'Ticketio-Webhooks/1',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      })
      return { status: res.status }
    },
    sign: signWebhookBody,
    now: () => new Date().toISOString(),
    nowUnix: () => String(Math.floor(Date.now() / 1000)),
  }
}
