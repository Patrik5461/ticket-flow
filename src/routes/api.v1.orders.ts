import { createFileRoute } from '@tanstack/react-router'
import { serviceClient } from '../lib/supabase/server'
import { withApiKey, apiJson } from '../server/api-auth'
import { listOrders, parseListParams } from '../server/api-v1'

/**
 * GET /api/v1/orders — the organizer's orders across their events.
 * Query: status, event_id, limit, offset.
 */
export const Route = createFileRoute('/api/v1/orders')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withApiKey(request, async (ctx) => {
          const sp = new URL(request.url).searchParams
          const p = parseListParams(sp)
          const data = await listOrders(serviceClient(), ctx.organizerId, {
            ...p,
            status: sp.get('status'),
            eventId: sp.get('event_id'),
          })
          return apiJson({ data, limit: p.limit, offset: p.offset }, ctx)
        }),
    },
  },
})
