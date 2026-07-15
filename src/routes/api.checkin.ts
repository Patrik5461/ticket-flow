import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import {
  getUserIdFromRequest,
  organizerIdForUser,
} from '../lib/supabase/auth-request'
import { checkInTicket } from '../server/checkin-service'

/**
 * POST /api/checkin — process one scanned ticket QR.
 *
 * Body: { eventId, qr, deviceLabel? }. Authorized by session cookie: the caller
 * must be a member of the organizer that owns the event (any role, including the
 * dedicated `checkin` role). Returns the scan outcome as JSON — 200 for every
 * recognized attempt (ok / already_used / cancelled / invalid), non-200 only for
 * auth or malformed-body failures. The handler is idempotent (see checkInTicket).
 */
const bodySchema = z.object({
  eventId: z.string().uuid(),
  qr: z.string().min(1).max(512),
  deviceLabel: z.string().max(120).optional(),
})

export const Route = createFileRoute('/api/checkin')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getUserIdFromRequest(request)
        if (!userId) {
          return Response.json({ error: 'Neprihlásený.' }, { status: 401 })
        }
        const organizerId = await organizerIdForUser(userId)
        if (!organizerId) {
          return Response.json({ error: 'Bez organizátora.' }, { status: 403 })
        }

        let body: z.infer<typeof bodySchema>
        try {
          body = bodySchema.parse(await request.json())
        } catch {
          return Response.json({ error: 'Neplatný vstup.' }, { status: 400 })
        }

        const result = await checkInTicket({
          eventId: body.eventId,
          organizerId,
          qr: body.qr,
          userId,
          deviceLabel: body.deviceLabel ?? null,
        })
        if (!result) {
          // Event does not belong to this organizer.
          return Response.json({ error: 'Bez oprávnenia.' }, { status: 403 })
        }

        return Response.json(result, {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        })
      },
    },
  },
})
