import { createFileRoute } from '@tanstack/react-router'
import {
  getUserIdFromRequest,
  organizerIdForRequest,
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
 * Impersonation resolves exactly as it does for server fns, so a platform admin
 * viewing an organizer sees the same live dashboard they do.
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
          organizerIdForUser: (userId) => organizerIdForRequest(request, userId),
          loadSnapshot: (eventId, organizerId) =>
            loadSalesSnapshot(eventId, organizerId),
        }),
    },
  },
})
