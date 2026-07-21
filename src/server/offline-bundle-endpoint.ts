/**
 * Core logic of GET /api/offline-bundle, extracted from the route so it can be
 * unit tested with injected dependencies (no live Supabase).
 *
 * Authorization is IDENTICAL to /api/checkin: a Supabase Bearer token (native
 * app) or a session cookie (web), then the organizer-membership check, then the
 * event-ownership check inside the loader. Bearer is accepted only on the two
 * endpoints the scan app needs — never on admin / revenue / export routes.
 *
 * Server-only.
 */
import { z } from 'zod'
import type { OfflineBundlePage } from './offline-bundle'

const querySchema = z.object({
  eventId: z.string().uuid(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})

export interface OfflineBundleDeps {
  checkRate: (request: Request) => boolean
  resolveUserId: (request: Request) => Promise<string | null>
  organizerIdForUser: (userId: string) => Promise<string | null>
  /** Null = the event does not belong to this organizer. */
  loadBundle: (input: {
    eventId: string
    organizerId: string
    offset: number
    limit: number
  }) => Promise<OfflineBundlePage | null>
}

const json = (body: unknown, status: number, headers?: Record<string, string>) =>
  Response.json(body, { status, headers })

export async function handleOfflineBundle(
  request: Request,
  deps: OfflineBundleDeps,
): Promise<Response> {
  if (!deps.checkRate(request)) {
    return json({ error: 'Príliš veľa pokusov.' }, 429)
  }

  const userId = await deps.resolveUserId(request)
  if (!userId) return json({ error: 'Neprihlásený.' }, 401)

  const organizerId = await deps.organizerIdForUser(userId)
  if (!organizerId) return json({ error: 'Bez organizátora.' }, 403)

  let query: z.infer<typeof querySchema>
  try {
    const url = new URL(request.url)
    query = querySchema.parse({
      eventId: url.searchParams.get('eventId'),
      offset: url.searchParams.get('offset') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    })
  } catch {
    return json({ error: 'Neplatný vstup.' }, 400)
  }

  const page = await deps.loadBundle({ ...query, organizerId })
  if (!page) return json({ error: 'Bez oprávnenia.' }, 403)

  // Attendee names — never cached by any intermediary.
  return json(page, 200, { 'Cache-Control': 'no-store' })
}
