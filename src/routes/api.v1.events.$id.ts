import { createFileRoute } from '@tanstack/react-router'
import { serviceClient } from '../lib/supabase/server'
import { withApiKey, apiJson, apiError } from '../server/api-auth'
import { getEvent } from '../server/api-v1'

/** GET /api/v1/events/{id} — event detail incl. ticket types. */
export const Route = createFileRoute('/api/v1/events/$id')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        withApiKey(request, async (ctx) => {
          const event = await getEvent(
            serviceClient(),
            ctx.organizerId,
            params.id,
          )
          if (!event) {
            return apiError(404, 'not_found', 'Podujatie sa nenašlo.')
          }
          return apiJson({ data: event }, ctx)
        }),
    },
  },
})
