import { createFileRoute } from '@tanstack/react-router'
import { getEnv } from '../lib/env'
import {
  issueSettlementInvoices,
  realInvoicingDeps,
} from '../server/settlement-invoicing'

/**
 * Commission-invoice worker endpoint. Pinged monthly by the pg_cron tick
 * (trigger_invoice_issuing → pg_net) when settlements are missing an invoice.
 * Guarded by the shared CRON_SECRET. Issues invoices for settlements without one.
 */
async function handle(request: Request): Promise<Response> {
  const secret = getEnv().CRON_SECRET
  const provided = request.headers.get('x-cron-secret') ?? ''
  if (!secret || provided !== secret) {
    return new Response('Unauthorized', { status: 401 })
  }
  const result = await issueSettlementInvoices(realInvoicingDeps(), {
    limit: 100,
  })
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}

export const Route = createFileRoute('/api/cron/issue-invoices')({
  server: {
    handlers: {
      POST: ({ request }) => handle(request),
    },
  },
})
