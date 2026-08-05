import { createFileRoute } from '@tanstack/react-router'
import { cronUnauthorized } from '../server/cron-auth'
import { processRefundJobs } from '../server/refund-jobs'
import { realJobDeps } from '../server/refund-jobs-runtime'

/**
 * Refund-queue worker endpoint. Pinged every minute by the pg_cron tick
 * (trigger_refund_processing → pg_net) when refund_jobs are pending. Guarded by a
 * shared secret (x-cron-secret / CRON_SECRET). Drains a batch of jobs idempotently
 * with bounded retries and returns the counts.
 */
async function handle(request: Request): Promise<Response> {
  const denied = cronUnauthorized(request)
  if (denied) return denied
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
