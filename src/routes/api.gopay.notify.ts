import { createFileRoute } from '@tanstack/react-router'
import { handleGoPayNotification } from '../server/order-service'

/**
 * GoPay notification endpoint. GoPay calls this (GET, sometimes POST) with the
 * payment id in the query string. We never trust the call itself — we re-read the
 * payment state from the GoPay API inside handleGoPayNotification, which is
 * idempotent via the payment_events ledger. Always answer 200 so GoPay stops
 * retrying once we've accepted it.
 */
async function handle(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id')
  if (id) {
    try {
      await handleGoPayNotification(id)
    } catch {
      // Swallow: a 500 would make GoPay retry endlessly. Reconciliation on the
      // order page + cron are the safety nets.
    }
  }
  return new Response('OK', { status: 200 })
}

export const Route = createFileRoute('/api/gopay/notify')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
})
