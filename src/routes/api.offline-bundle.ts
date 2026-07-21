import { createFileRoute } from '@tanstack/react-router'
import {
  getUserIdFromBearerOrCookie,
  organizerIdForUser,
} from '../lib/supabase/auth-request'
import { loadOfflineBundle } from '../server/offline-bundle'
import { handleOfflineBundle } from '../server/offline-bundle-endpoint'
import { clientIpFromHeaders } from '../lib/client-ip'
import { offlineBundleLimiter } from '../server/rate-guards'

/**
 * GET /api/offline-bundle?eventId=…&offset=0&limit=500 — the ticket list the
 * native Ticketio Scan app caches for offline check-in.
 *
 * Authorized exactly like /api/checkin (Bearer token or session cookie, then
 * organizer membership + event ownership). The payload contains SHA-256 digests
 * of ticket QR tokens, never the event's qr_secret — see server/offline-bundle.
 *
 * Core logic lives in server/offline-bundle-endpoint.ts (unit tested with
 * injected deps); this route only wires the real implementations.
 */
export const Route = createFileRoute('/api/offline-bundle')({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleOfflineBundle(request, {
          checkRate: (req) =>
            offlineBundleLimiter.check(clientIpFromHeaders(req.headers)).ok,
          resolveUserId: getUserIdFromBearerOrCookie,
          organizerIdForUser,
          loadBundle: (input) => loadOfflineBundle(input),
        }),
    },
  },
})
