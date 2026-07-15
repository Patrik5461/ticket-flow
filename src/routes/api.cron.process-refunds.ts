import { createFileRoute } from '@tanstack/react-router'
import { getEnv } from '../lib/env'
import { processRefundJobs } from '../server/refund-jobs'
import { realJobDeps } from '../server/refund-jobs-runtime'

/**
 * Refund-queue worker endpoint. Pinged every minute by the pg_cron tick
 * (trigger_refund_processing → pg_net) when refund_jobs are pending. Guarded by a
 * shared secret (x-cron-secret / CRON_SECRET). Drains a batch of jobs idempotently
 * with bounded retries and returns the counts.
 */
async function handle(request: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET
  const provided = request.headers.get('x-cron-secret') ?? ''
  if (!secret || provided !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }
  const result = await processRefundJobs(realJobDeps(), { limit: 50 })
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}

export const Route = createFileRoute('/api/cron/process-refunds')({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
})
