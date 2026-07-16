import { createFileRoute } from '@tanstack/react-router'
import { serviceClient } from '../lib/supabase/server'

/**
 * GET /api/health — liveness + DB reachability for uptime monitoring. Never
 * throws; reports db:false instead of a 500 so the checker can distinguish
 * "app up, DB down" from "app down". Public, no-store.
 */
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        let db = false
        try {
          const { error } = await serviceClient()
            .from('app_settings')
            .select('key')
            .limit(1)
          db = !error
        } catch {
          db = false
        }
        return Response.json(
          { status: 'ok', db },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      },
    },
  },
})
