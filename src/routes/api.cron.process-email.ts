import { createFileRoute } from '@tanstack/react-router'
import { cronUnauthorized } from '../server/cron-auth'
import { processEmailJobs } from '../server/email-jobs'
import { realEmailJobsDeps } from '../server/email-jobs-runtime'

/**
 * Email-queue worker endpoint. Pinged by the pg_cron tick
 * (trigger_email_processing → pg_net) when email_jobs are pending. Guarded by the
 * shared CRON_SECRET. Drains a batch (reminders + bulk) idempotently with retries.
 */
async function handle(request: Request): Promise<Response> {
  const denied = cronUnauthorized(request)
  if (denied) return denied
  const result = await processEmailJobs(realEmailJobsDeps(), { limit: 100 })
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}

export const Route = createFileRoute('/api/cron/process-email')({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
})
