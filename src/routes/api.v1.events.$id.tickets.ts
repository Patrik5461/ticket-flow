import { createFileRoute } from '@tanstack/react-router'
import { serviceClient } from '../lib/supabase/server'
import { withApiKey, apiJson, apiError } from '../server/api-auth'
import { listEventTickets, parseListParams } from '../server/api-v1'

/**
 * GET /api/v1/events/{id}/tickets — tickets of an owned event with check-in
 * status. Query: status, limit, offset.
 */
export const Route = createFileRoute('/api/v1/events/$id/tickets')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withApiKey(request, async (ctx) => {
          const sp = new URL(request.url).searchParams
          const p = parseListParams(sp)
          const data = await listEventTickets(
            serviceClient(),
            ctx.organizerId,
            params.id,
            { ...p, status: sp.get('status') },
          )
          if (data === null) {
            return apiError(404, 'not_found', 'Podujatie sa nenašlo.')
          }
          return apiJson({ data, limit: p.limit, offset: p.offset }, ctx)
        }),
    },
  },
})
