/**
 * Core logic of POST /api/checkin, extracted from the route so it can be unit
 * tested with injected dependencies (no live Supabase). The route wires the
 * real implementations; tests inject fakes to exercise every status path.
 *
 * Auth accepts EITHER a session cookie (web) OR a Supabase Bearer token (native
 * Ticketio Scan app) — resolved by `resolveUserId`. Either way the SAME
 * organizer-membership check runs next, so authorization is identical. Rate
 * limiting and the check-in audit trail are unchanged.
 *
 * Server-only.
 */
import { z } from 'zod'
import type { CheckinResponse } from './checkin-service'

const bodySchema = z.object({
  eventId: z.string().uuid(),
  qr: z.string().min(1).max(512),
  deviceLabel: z.string().max(120).optional(),
})

export interface CheckinDeps {
  /** Rate-limit gate keyed on the request (client IP). */
  checkRate: (request: Request) => boolean
  /** Resolve the caller's user id from a Bearer token or session cookie. */
  resolveUserId: (request: Request) => Promise<string | null>
  /** The organizer the user belongs to (membership check), or null. */
  organizerIdForUser: (userId: string) => Promise<string | null>
  /** Process one scanned ticket. Null = event not owned by this organizer. */
  checkInTicket: (input: {
    eventId: string
    organizerId: string
    qr: string
    userId: string
    deviceLabel: string | null
  }) => Promise<CheckinResponse | null>
}

const json = (body: unknown, status: number, headers?: Record<string, string>) =>
  Response.json(body, { status, headers })

export async function handleCheckin(
  request: Request,
  deps: CheckinDeps,
): Promise<Response> {
  if (!deps.checkRate(request)) {
    return json({ error: 'Príliš veľa pokusov.' }, 429)
  }

  const userId = await deps.resolveUserId(request)
  if (!userId) {
    return json({ error: 'Neprihlásený.' }, 401)
  }

  const organizerId = await deps.organizerIdForUser(userId)
  if (!organizerId) {
    return json({ error: 'Bez organizátora.' }, 403)
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch {
    return json({ error: 'Neplatný vstup.' }, 400)
  }

  const result = await deps.checkInTicket({
    eventId: body.eventId,
    organizerId,
    qr: body.qr,
    userId,
    deviceLabel: body.deviceLabel ?? null,
  })
  if (!result) {
    // Event does not belong to this organizer.
    return json({ error: 'Bez oprávnenia.' }, 403)
  }

  return json(result, 200, { 'Cache-Control': 'no-store' })
}
