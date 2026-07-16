import { createFileRoute } from '@tanstack/react-router'
import { serviceClient } from '../lib/supabase/server'
import { withApiKey, apiJson } from '../server/api-auth'

/**
 * GET /api/v1/me — returns the organizer the API key belongs to. The simplest
 * authenticated endpoint; handy to verify a key works.
 */
export const Route = createFileRoute('/api/v1/me')({
  server: {
    handlers: {
      GET: ({ request }) =>
        withApiKey(request, async (ctx) => {
          const { data: org } = await serviceClient()
            .from('organizers')
            .select('id, name, slug')
            .eq('id', ctx.organizerId)
            .maybeSingle<{ id: string; name: string; slug: string }>()
          return apiJson({ organizer: org }, ctx)
        }),
    },
  },
})
