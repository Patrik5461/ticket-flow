import { createFileRoute } from '@tanstack/react-router'
import {
  getUserIdFromBearerOrCookie,
  organizerIdForUser,
} from '../lib/supabase/auth-request'
import { checkInTicket } from '../server/checkin-service'
import { handleCheckin } from '../server/checkin-endpoint'
import { clientIpFromHeaders } from '../lib/client-ip'
import { checkinLimiter } from '../server/rate-guards'

/**
 * POST /api/checkin — process one scanned ticket QR.
 *
 * Body: { eventId, qr, deviceLabel? }. Authorized by session cookie (web) OR a
 * Supabase Bearer token (native Ticketio Scan app) — either way the caller must
 * be a member of the organizer that owns the event (any role, including the
 * dedicated `checkin` role). Bearer is only a different transport for the same
 * credential; the membership check is identical, and it is accepted ONLY here,
 * not on the admin/revenue/export endpoints. Returns the scan outcome as JSON —
 * 200 for every recognized attempt (ok / already_used / cancelled / invalid),
 * non-200 only for auth or malformed-body failures. Idempotent (checkInTicket).
 *
 * Core logic lives in server/checkin-endpoint.ts (unit tested with injected
 * deps); this route only wires the real implementations.
 */
export const Route = createFileRoute('/api/checkin')({
  server: {
    handlers: {
      POST: ({ request }) =>
        handleCheckin(request, {
          checkRate: (req) =>
            checkinLimiter.check(clientIpFromHeaders(req.headers)).ok,
          resolveUserId: getUserIdFromBearerOrCookie,
          organizerIdForUser,
          checkInTicket: (input) => checkInTicket(input),
        }),
    },
  },
})
