import { createFileRoute } from '@tanstack/react-router'
import { getEnv } from '../lib/env'
import { processWaitlist } from '../server/waitlist'
import { realWaitlistDeps } from '../server/waitlist-runtime'

/**
 * Waitlist worker endpoint. Pinged by the pg_cron tick
 * (trigger_waitlist_processing → pg_net) when a waiting entry's ticket type has
 * free capacity. Guarded by the shared CRON_SECRET. Notifies the first N waiting
 * people per type with a time-limited checkout link; idempotent.
 */
async function handle(request: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET
  const provided = request.headers.get('x-cron-secret') ?? ''
  if (!secret || provided !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }
  const result = await processWaitlist(realWaitlistDeps(), { limit: 200 })
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}

export const Route = createFileRoute('/api/cron/process-waitlist')({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
})
