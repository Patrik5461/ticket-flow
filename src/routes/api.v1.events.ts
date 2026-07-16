import { createFileRoute } from '@tanstack/react-router'
import { serviceClient } from '../lib/supabase/server'
import { withApiKey, apiJson } from '../server/api-auth'
import { listEvents, parseListParams } from '../server/api-v1'

/** GET /api/v1/events — the organizer's events. Query: status, limit, offset. */
export const Route = createFileRoute('/api/v1/events')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withApiKey(request, async (ctx) => {
          const sp = new URL(request.url).searchParams
          const params = parseListParams(sp)
          const data = await listEvents(serviceClient(), ctx.organizerId, {
            ...params,
            status: sp.get('status'),
          })
          return apiJson(
            { data, limit: params.limit, offset: params.offset },
            ctx,
          )
        }),
    },
  },
})
