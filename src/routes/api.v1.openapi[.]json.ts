import { createFileRoute } from '@tanstack/react-router'
import { openApiSpec } from '../lib/openapi'
import { SITE_URL } from '../lib/site'

/** GET /api/v1/openapi.json — machine-readable API spec (public). */
export const Route = createFileRoute('/api/v1/openapi.json')({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(openApiSpec(`${SITE_URL}/api/v1`)), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
    },
  },
})
