import { createFileRoute } from '@tanstack/react-router'
import { getEnv } from '../lib/env'
import { processWebhooks } from '../server/webhooks'
import { realWebhookDeps } from '../server/webhooks-runtime'

/**
 * Webhook worker endpoint. Pinged by the pg_cron tick
 * (trigger_webhook_processing → pg_net) when deliveries are claimable. Guarded by
 * the shared CRON_SECRET. Drains a batch with HMAC-signed, retried POSTs.
 */
async function handle(request: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET
  const provided = request.headers.get('x-cron-secret') ?? ''
  if (!secret || provided !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }
  const result = await processWebhooks(realWebhookDeps(), { limit: 50 })
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}

export const Route = createFileRoute('/api/cron/process-webhooks')({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
})
