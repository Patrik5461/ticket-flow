import { createFileRoute } from '@tanstack/react-router'
import {
  getUserIdFromRequest,
  organizerIdForUser,
} from '../lib/supabase/auth-request'
import { loadSalesSnapshot } from '../server/sales-live'
import { handleSalesStream } from '../server/sales-stream'

/**
 * GET /api/events/$eventId/sales-stream — Server-Sent Events feed of the live
 * sales snapshot for the organizer dashboard.
 *
 * Authorized by the session COOKIE only (deliberately not Bearer: this is the
 * web dashboard, and the native app has no business here), then by organizer
 * membership and event ownership — the same chain as every other event route.
 *
 * See server/sales-stream.ts for why this is SSE rather than a browser-side
 * Supabase realtime subscription.
 */
export const Route = createFileRoute('/api/events/$eventId/sales-stream')({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleSalesStream(request, params.eventId, {
          resolveUserId: getUserIdFromRequest,
          organizerIdForUser,
          loadSnapshot: (eventId, organizerId) =>
            loadSalesSnapshot(eventId, organizerId),
        }),
    },
  },
})
